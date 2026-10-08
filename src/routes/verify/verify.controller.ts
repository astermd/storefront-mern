import { Body, Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { STEP_ROUTER } from '../../core/tokens';
import { Cart } from '../../domain/cart';
import { StepRouter } from '../../domain/step-router';
import { VerificationStatus } from '../../journey/journey-state';
import { JourneyState } from '../../journey/journey-state';
import { FurthestStep } from '../../funnel/furthest-step';
import { FlowDefinition } from '../../funnel/flow-definition';
import { StepPreconditions } from '../../funnel/step-preconditions';
import { CartStoreFactory } from '../../journey/cart-store-factory';
import { JourneyStoreFactory } from '../../journey/journey-store-factory';
import { OperatorLog } from '../../support/operator-log';
import { VerificationStep } from '../../verification/verification-step';

/** This controller's own step name, as `config/funnel.ts` declares it. */
const STEP = 'verify';

/** Where a visitor goes when the routing decision names the step they are standing on. */
const STEP_AFTER = 'checkout';

/**
 * What each recorded outcome says to a buyer the gate will let past. Written as a table because the
 * alternative — a conditional in the template — is where "did not pass" quietly becomes "failed".
 */
const NOTICE: Record<VerificationStatus, string> = {
  passed: 'Your identity has been confirmed. You can carry on.',
  failed:
    'We could not confirm your identity from the details we hold. We have noted that and you can carry on; contact support if you would like us to look again.',
  inconclusive: 'This check could not be completed just now. Nothing is wrong with the details you gave us, and you can carry on.',
};

/** What the same outcomes say to a buyer the gate is holding. */
const HELD_NOTICE: Partial<Record<VerificationStatus, string>> = {
  failed:
    'We could not confirm your identity from the details we hold, and we cannot continue until it is confirmed. There is nothing to change on this page — if one of the details you gave us earlier is wrong, go back and correct it. Otherwise contact support and we will confirm it with you.',
  inconclusive:
    'This check could not be completed just now, and we cannot continue until it has run. Nothing is wrong with the details you gave us. Try again in a few minutes, or contact support and we will complete it with you.',
};

/**
 * Ported from storefront-lamp/core/Http/Controller/VerifyController.php. The identity-verification
 * step (`[22.13]`).
 *
 * **Guarding is not repeated here.** `/verify/` is a step in `config/funnel.ts` with its own
 * requirements, and `StepGuardMiddleware` enforces them before this controller is reached
 * (`[22.11]`). The one precondition this controller *asks* about is `verification_satisfied`, and
 * it asks `StepPreconditions` rather than re-deriving it — `[22.16]` says placement and blocking
 * are separate settings that must not be conflated.
 *
 * **The outcome is read back off the journey rather than passed through the redirect** — a
 * post/redirect/get costs nothing and buys a page that survives a refresh, a back button and a
 * guard bouncing the visitor back onto it.
 *
 * **Three outcomes reach the buyer as three different sentences, and each has two forms** — a
 * verdict that did not pass is a note on the file under a non-blocking placement and a closed door
 * under a blocking one. Which form is used is `StepPreconditions` answering the same question the
 * gate on the next step will answer, so what the buyer is told and what happens to them cannot
 * disagree.
 */
@Controller()
export class VerifyController {
  constructor(
    private readonly step: VerificationStep,
    private readonly cartStoreFactory: CartStoreFactory,
    private readonly journeyStoreFactory: JourneyStoreFactory,
    private readonly flow: FlowDefinition,
    @Inject(STEP_ROUTER) private readonly router: StepRouter,
    private readonly preconditions: StepPreconditions,
    private readonly log: OperatorLog,
  ) {}

  @Get('verify')
  async show(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.render(req, res, this.cart(), this.journeyStoreFactory.get().currentState(), false);
  }

  /**
   * Runs the checks, records the outcome, and hands the visitor on.
   *
   * The redirect target is the routing decision rather than a hardcoded `/checkout/`, so a journey
   * that has been disqualified or has lost its cart between the render and the submit is sent
   * somewhere that will have it. Re-rendering instead of redirecting is reserved for the one case
   * where the redirect would not land: a placement that is holding this visitor.
   */
  @Post('verify')
  async submit(@Body() body: Record<string, unknown>, @Req() req: Request, @Res() res: Response): Promise<void> {
    const cart = this.cart();
    const state = this.journeyStoreFactory.get().currentState();

    if (state === null) {
      this.log.warning('verify.journey_unavailable', {});
    } else {
      await this.step.run(cart, state, body, req.ip ?? null);
    }

    if (!this.preconditions.satisfied('verification_satisfied', cart, state)) {
      await this.render(req, res, cart, state, true);
      return;
    }

    // The step is behind them now — the verdict is recorded and the gate has agreed it may stand.
    if (state !== null) {
      FurthestStep.advance(state, STEP);
    }

    res.redirect(303, this.onwardPath(cart, state));
  }

  /**
   * The page, with the copy that matches what the gate will do to this visitor. `attempted`
   * separates a buyer who has just run the checks from one who has only opened the page — under a
   * blocking placement the gate refuses both, so without it a first visit would open with an
   * outage notice for an outage that has not happened.
   */
  private async render(req: Request, res: Response, cart: Cart, state: JourneyState | null, attempted: boolean): Promise<void> {
    const status = state?.verification?.status ?? null;
    const held = !this.preconditions.satisfied('verification_satisfied', cart, state);
    const notice = this.notice(status, held, attempted);

    // Nest defaults every @Post() handler's status to 201, even with a raw @Res() — and
    // `res.render()` never overrides it. This helper is also reached from `submit()` (a POST) when
    // the placement holds the visitor, and a re-rendered page is not a created resource.
    res.status(200);
    res.render('pages/verify', {
      noindex: true,
      collect_ssn: this.step.collectsSsn(),
      verification_status: status,
      verification_notice: notice,
      verification_failed: status === 'failed',
      // Tied to the notice rather than to the hold, so the page cannot offer a "Try again" with
      // nothing above it saying why.
      verification_held: held && notice !== null,
      back_path: this.flow.pathFor('intake.medical'),
    });
  }

  /**
   * The sentence this visitor is owed, or null when they are owed none. A held submit with no
   * recorded verdict at all takes the `inconclusive` line — the outcome could not be written down,
   * so the check did not complete; it must never become a `failed` line (`[20.1]`).
   */
  private notice(status: VerificationStatus | null, held: boolean, attempted: boolean): string | null {
    if (status === null) {
      return held && attempted ? HELD_NOTICE.inconclusive! : null;
    }

    if (held) {
      return HELD_NOTICE[status] ?? NOTICE[status] ?? null;
    }

    return NOTICE[status] ?? null;
  }

  /**
   * Where the routing decision sends this visitor, with the one answer it must never give here
   * taken out. A controller that 303s to the step it is already on is a loop no guard can see and
   * no log records.
   */
  private onwardPath(cart: Cart, state: JourneyState | null): string {
    let next = this.router.nextStep(cart, state);

    if (next === STEP) {
      this.log.warning('verify.onward_self_redirect', {
        reason: 'the routing decision named this step for a journey the gate has already let past',
      });
      next = STEP_AFTER;
    }

    return this.flow.pathFor(next);
  }

  private cart(): Cart {
    try {
      return this.cartStoreFactory.get().currentCart();
    } catch (e) {
      this.log.warning('verify.cart_unavailable', { exception: e instanceof Error ? e.constructor.name : 'unknown' });
      return new Cart();
    }
  }
}
