import { Body, Controller, Get, Inject, Post, Req, Res, UseInterceptors } from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { Cart } from '../../domain/cart';
import { StepRouter } from '../../domain/step-router';
import { PRODUCT_CATALOG, STEP_ROUTER } from '../../core/tokens';
import { ProductCatalog } from '../../domain/product-catalog';
import { Field } from '../../forms/field';
import { FieldViewModel } from '../../forms/field-view-model';
import { FormUnavailable } from '../../forms/form-unavailable';
import { IntakeSession } from '../../forms/intake-session';
import { IntakeView } from '../../forms/intake-view';
import { ProgressSteps } from '../../forms/progress-steps';
import { InjectedCss } from '../../forms/injected-css';
import { RuleEvaluator } from '../../forms/rule-evaluator';
import { FlowDefinition } from '../../funnel/flow-definition';
import { FunnelRules } from '../../funnel/funnel-rules';
import { CartStoreFactory } from '../../journey/cart-store-factory';
import { JourneyStoreFactory } from '../../journey/journey-store-factory';
import { ConfigService } from '../../support/config';
import { OperatorLog } from '../../support/operator-log';
import { RateLimiter } from '../../support/rate-limiter';
import { FileRules } from '../../forms/file-rules';

const UNRECORDED_COMPLETIONS = '_intake_unrecorded_completions';

/** How many completed submits may fail forward before the visitor is told plainly that the questionnaire cannot be recorded. */
const FAIL_FORWARD_ATTEMPTS = 2;

/**
 * Ported from storefront-lamp/core/Http/Controller/IntakeController.php. The intake and
 * pre-qualification steps.
 *
 * Which questionnaire a step collects comes from the cart, via `FunnelRules` — the same answer
 * `StepPreconditions` guards the step with and `FunnelRouter` routes on (`[8.2]`, `[8.3]`).
 * Deciding it here as well is what stranded a visitor between a gate waiting for one form and a
 * page serving another, so the rule is asked for rather than restated.
 */
@Controller()
export class IntakeController {
  private readonly rules: FunnelRules;
  private readonly limiter = new RateLimiter(20, 60);

  constructor(
    private readonly intake: IntakeSession,
    private readonly cartStoreFactory: CartStoreFactory,
    private readonly journeyStoreFactory: JourneyStoreFactory,
    @Inject(PRODUCT_CATALOG) catalog: ProductCatalog,
    private readonly flow: FlowDefinition,
    private readonly evaluator: RuleEvaluator,
    private readonly config: ConfigService,
    private readonly log: OperatorLog,
    @Inject(STEP_ROUTER) private readonly router: StepRouter,
  ) {
    this.rules = new FunnelRules(catalog);
  }

  /**
   * The welcome page — a static render in the PHP original (its generic `PageController`), kept
   * here since this port has no general-purpose static-page controller yet.
   */
  @Get('intake')
  welcome(@Res() res: Response): void {
    res.render('pages/intake/welcome', { noindex: true });
  }

  @Get('intake/eligibility')
  async prequalification(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.render(req, res, IntakeSession.STEP_PREQUALIFICATION);
  }

  @Get('intake/medical')
  async intakeStep(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.render(req, res, IntakeSession.STEP_INTAKE);
  }

  /**
   * `AnyFilesInterceptor` runs multer over the request before `@Body()` is read. Every one of
   * `intake.js`'s posts (save, submit, capture) sends a `fetch` with a `FormData` body — which the
   * browser always encodes as `multipart/form-data`, regardless of this HTML form's own enctype —
   * and this app parses no other multipart body anywhere, so without it `req.body` is `undefined`
   * here. No file field is expected on this route; the interceptor is here purely to populate the
   * ordinary form fields.
   */
  @Post('intake/save')
  @UseInterceptors(AnyFilesInterceptor())
  async save(@Body() body: Record<string, unknown>, @Req() req: Request, @Res() res: Response): Promise<void> {
    const step = this.stepOf(req, body);
    const teleformId = this.teleformId(step);
    if (teleformId === null) {
      res.redirect(303, this.onwardPath());
      return;
    }

    let result;
    try {
      result = await this.intake.save(teleformId, step, IntakeController.answersFrom(body), Number(body.page ?? 0));
    } catch (e) {
      if (e instanceof FormUnavailable) {
        await this.unavailable(req, res);
        return;
      }
      throw e;
    }

    if (result.disqualified()) {
      res.redirect(303, this.flow.pathFor('not_eligible'));
      return;
    }

    if (!result.valid()) {
      await this.render(req, res, step, result.errors);
      return;
    }

    res.redirect(303, this.flow.stepForPath(this.pathOf(step)) === null ? '/' : this.pathOf(step));
  }

  /** See `save()`'s doc comment — same multipart-body reason. */
  @Post('intake/submit')
  @UseInterceptors(AnyFilesInterceptor())
  async submit(@Body() body: Record<string, unknown>, @Req() req: Request, @Res() res: Response): Promise<void> {
    const step = this.stepOf(req, body);
    const teleformId = this.teleformId(step);
    if (teleformId === null) {
      await this.onward(req, res, step);
      return;
    }

    let result;
    try {
      result = await this.intake.submit(teleformId, step, IntakeController.answersFrom(body));
    } catch (e) {
      if (e instanceof FormUnavailable) {
        await this.unavailable(req, res);
        return;
      }
      throw e;
    }

    if (result.disqualified()) {
      res.redirect(303, this.flow.pathFor('not_eligible'));
      return;
    }

    if (!result.valid()) {
      await this.render(req, res, step, result.errors);
      return;
    }

    await this.onward(req, res, step);
  }

  /**
   * Early capture (`[9.4]`): the lead is created the moment a first name and an email are both
   * known. The response says only whether a record was made (`[9.6]`) — echoing any submitted
   * value back would put clinical answers into a body a proxy or an access log could keep.
   */
  @Post('intake/capture')
  @UseInterceptors(AnyFilesInterceptor())
  async capture(@Body() body: Record<string, unknown>, @Req() req: Request, @Res() res: Response): Promise<void> {
    const step = this.stepOf(req, body);
    const teleformId = this.teleformId(step);

    if (!this.limiter.allow(req.session as unknown as Record<string, unknown>, 'intake.capture')) {
      this.log.info('intake.capture_rate_limited', {});
      res.status(429).json({ captured: false });
      return;
    }

    // Nest defaults every @Post() handler's status to 201, even with a raw @Res() — and
    // `res.json()` never overrides it. Nothing here creates a resource the caller can address.
    res.status(200);

    if (teleformId === null) {
      res.json({ captured: false });
      return;
    }

    try {
      const outcome = await this.intake.capture(teleformId, IntakeController.answersFrom(body));
      res.json({ captured: outcome.created() });
    } catch (e) {
      if (e instanceof FormUnavailable) {
        res.json({ captured: false });
        return;
      }
      throw e;
    }
  }

  private async render(req: Request, res: Response, step: string, errors: Record<string, string> = {}): Promise<void> {
    // Drawing the questionnaire is the commonest way a visitor comes back through an outage, so
    // it is where the tally has to be forgotten.
    this.forgetFailedCompletions(req);

    const teleformId = this.teleformId(step);
    if (teleformId === null) {
      res.redirect(303, this.onwardPath());
      return;
    }

    let view: IntakeView;
    try {
      view = await this.intake.open(teleformId, step);
    } catch (e) {
      if (e instanceof FormUnavailable) {
        await this.unavailable(req, res);
        return;
      }
      throw e;
    }

    const renderer = this.config.intake.renderer;
    const template = renderer === 'js-engine' ? 'pages/intake/form-js-engine' : 'pages/intake/form';

    // Nest defaults every @Post() handler's status to 201, even with a raw @Res() — and
    // `res.render()` never overrides it. This helper is also reached from `save()`/`submit()` (both
    // POST) on a validation failure, and a re-rendered form is not a created resource.
    res.status(200);
    res.render(template, await this.payload(view, step, errors, renderer));
  }

  private async payload(view: IntakeView, step: string, errors: Record<string, string>, renderer: string): Promise<Record<string, unknown>> {
    const answers = view.answers.all();
    const rules = view.rules.map((rule) => ({ id: rule.id, mode: rule.mode, message: rule.message, conditions: rule.conditions }));

    const payload: Record<string, unknown> = {
      noindex: true,
      definition: view.definition,
      form_title: step === IntakeSession.STEP_PREQUALIFICATION ? 'Eligibility' : 'Medical intake',
      form_step: step,
      unsupported_types: view.unsupportedTypes,
      termination_message: view.terminationMessage,
      injected_css: InjectedCss.safe(IntakeController.optionalSetting(view.definition, 'injectCss')),
      stepper_steps: ProgressSteps.from(view.definition),
      stepper_active: 1,
      intake_engine: this.config.intake.engine,
      definition_json: JSON.stringify(await this.intake.rawDefinition(view.metadata.id)),
      initial_values_json: Object.keys(answers).length === 0 ? '{}' : JSON.stringify(answers),
      rules_json: JSON.stringify(rules),
      form_errors: errors,
      // The most the page may send this server in one request, so a file goes up whole or in parts
      // this server can take.
      upload_request_bytes: FileRules.requestBytes(),
    };

    if (renderer === 'js-engine') return payload;

    // Mode C needs a view model per field, grouped by page.
    const fields: Record<string, unknown>[][] = [];
    view.definition.pages().forEach((page, index) => {
      fields[index] = page.fields.map((field) => this.viewModel(field, view, answers, errors));
    });

    payload.fields = fields;
    payload.definition_has_buttons = IntakeController.hasAuthoredButtons(view);
    // A failed submit/save re-renders every page, same as a fresh GET — nothing here says which
    // one actually failed. Without this, `intake.js` always opens back on page 0 regardless of
    // where the rejected field lives, which looks exactly like "my answers were thrown away and
    // I'm back at the start" even though they're all still there. `null` when nothing errored, so
    // an ordinary GET still opens on page 0.
    const erroredFieldNames = new Set(Object.keys(errors).filter((name) => name !== '_form'));
    const errorPageIndex = erroredFieldNames.size === 0
      ? null
      : view.definition.pages().findIndex((page) => page.fields.some((field) => erroredFieldNames.has(field.name)));
    payload.error_page = errorPageIndex !== null && errorPageIndex >= 0 ? errorPageIndex : null;

    return payload;
  }

  private viewModel(field: Field, view: IntakeView, answers: Record<string, unknown>, errors: Record<string, string>): Record<string, unknown> {
    const state = this.evaluator.state(field, answers, view.definition);
    const answer = field.type === 'bmi' ? answers : (answers[field.name] ?? null);
    return FieldViewModel.for(field, state, answer, errors[field.name] ?? null);
  }

  private static hasAuthoredButtons(view: IntakeView): boolean {
    return view.definition.fields().some((field) => field.type === 'button');
  }

  /** Only what the visitor could have answered — the framework's own fields never reach the answer set. */
  private static answersFrom(body: Record<string, unknown>): Record<string, unknown> {
    const rest = { ...body };
    delete rest._csrf;
    delete rest.page;
    delete rest.intake_next;
    delete rest.intake_submit;
    delete rest.step;
    return rest;
  }

  /**
   * Which questionnaire a request concerns. The save/submit/capture endpoints are shared by both
   * steps, and none of their paths names one — so the posted `step` field is the only thing that
   * can distinguish them.
   */
  private stepOf(req: Request, body: Record<string, unknown>): string {
    const posted = body.step;
    if (posted === IntakeSession.STEP_PREQUALIFICATION || posted === IntakeSession.STEP_INTAKE) {
      return posted;
    }

    return req.path.includes('/eligibility/') ? IntakeSession.STEP_PREQUALIFICATION : IntakeSession.STEP_INTAKE;
  }

  private pathOf(step: string): string {
    return this.flow.pathFor(step === IntakeSession.STEP_PREQUALIFICATION ? 'prequalification' : 'intake.medical');
  }

  /**
   * Where a finished questionnaire step hands the visitor next. Fails forward when the journey
   * cannot be loaded at all — the visitor has just submitted the form, and checkout's own guard
   * fails closed and is a better judge of a degraded journey than this controller is (`[20.1]`).
   */
  private onwardPath(): string {
    const state = this.journeyStoreFactory.get().currentState();
    if (state === null) {
      this.log.warning('intake.completion_unknown', { teleform: this.teleformId(IntakeSession.STEP_INTAKE) });
      return this.flow.pathFor('checkout');
    }

    return this.flow.pathFor(this.router.nextStep(this.cart(), state));
  }

  /**
   * The response a finished questionnaire step gets, and the end of the fail-forward loop. A
   * floor is put under the fail-forward: a visitor who has completed the form and been handed it
   * back twice is shown the form-unavailable page instead of looping a third time.
   */
  private async onward(req: Request, res: Response, step: string): Promise<void> {
    if (this.journeyStoreFactory.get().currentState() !== null) {
      this.forgetFailedCompletions(req);
      res.redirect(303, this.onwardPath());
      return;
    }

    const session = req.session as unknown as Record<string, number>;
    const attempt = 1 + (session[UNRECORDED_COMPLETIONS] ?? 0);
    session[UNRECORDED_COMPLETIONS] = attempt;

    if (attempt < FAIL_FORWARD_ATTEMPTS) {
      res.redirect(303, this.onwardPath());
      return;
    }

    if (attempt === FAIL_FORWARD_ATTEMPTS) {
      this.log.error('intake.completion_looping', {
        attempts: attempt,
        step,
        reason: 'the journey cannot be loaded, so the completed form cannot be routed past checkout',
      });
    }

    await this.unavailable(req, res, this.pathOf(step));
  }

  private forgetFailedCompletions(req: Request): void {
    if (this.journeyStoreFactory.get().currentState() === null) return;
    delete (req.session as unknown as Record<string, unknown>)[UNRECORDED_COMPLETIONS];
  }

  /** Which questionnaire this step collects, or null when it has nothing to ask. */
  private teleformId(step: string): string | null {
    const cart = this.cart();
    const state = this.journeyStoreFactory.get().currentState();

    return step === IntakeSession.STEP_PREQUALIFICATION
      ? this.rules.prequalificationFormToCollect(cart, state)
      : this.rules.intakeFormToCollect(cart, state);
  }

  private cart(): Cart {
    try {
      return this.cartStoreFactory.get().currentCart();
    } catch (e) {
      this.log.warning('intake.cart_unavailable', { exception: e instanceof Error ? e.constructor.name : 'unknown' });
      return new Cart();
    }
  }

  private async unavailable(req: Request, res: Response, retryPath: string | null = null): Promise<void> {
    // Nest defaults every @Post() handler's status to 201, even with a raw @Res() — and
    // `res.render()` never overrides it. This helper is also reached from `save()`/`submit()`/
    // `capture()` (all POST) on a `FormUnavailable`, and a degrade page is not a created resource.
    res.status(200);
    res.render('pages/intake/form-unavailable', {
      noindex: true,
      current_path: retryPath ?? req.path,
    });
  }

  private static optionalSetting(definition: IntakeView['definition'], key: string): string | null {
    const value = definition.setting(key);
    return typeof value === 'string' ? value : null;
  }
}
