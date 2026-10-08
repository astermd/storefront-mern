import { Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PRODUCT_CATALOG } from '../../core/tokens';
import { CartRules } from '../../domain/cart-rules';
import { ProductCatalog } from '../../domain/product-catalog';
import { Definition } from '../../forms/definition';
import { Disqualification } from '../../forms/disqualification';
import { FormUnavailable } from '../../forms/form-unavailable';
import { TeleformSource } from '../../forms/teleform-source';
import { FlowDefinition } from '../../funnel/flow-definition';
import { FunnelRules } from '../../funnel/funnel-rules';
import { CartMirror } from '../../emr/cart-mirror';
import { CartStoreFactory } from '../../journey/cart-store-factory';
import { JourneyStoreFactory } from '../../journey/journey-store-factory';
import { OperatorLog } from '../../support/operator-log';

/**
 * Ported from storefront-lamp/core/Http/Controller/NotEligibleController.php. The terminal page a
 * disqualified journey lands on, and the way back off it.
 *
 * The explanation shown is the one the form author wrote for the rule that fired, not a generic
 * line (`[10.42]`). Both ways off the page exist because a disqualifying answer is sometimes
 * simply a mistake (`[10.43]`): going back re-opens the questionnaire with every answer intact,
 * starting over is the destructive option and is where the triggering line leaves the cart
 * (`[10.47]`) — deliberately here rather than at the moment the rule fired, so a resumed terminal
 * state can still re-evaluate against the line that caused it (`[10.48]`).
 */
@Controller()
export class NotEligibleController {
  private readonly funnel: FunnelRules;

  constructor(
    private readonly source: TeleformSource,
    private readonly disqualification: Disqualification,
    private readonly cartStoreFactory: CartStoreFactory,
    @Inject(PRODUCT_CATALOG) catalog: ProductCatalog,
    private readonly rules: CartRules,
    private readonly mirror: CartMirror,
    private readonly journeyStoreFactory: JourneyStoreFactory,
    private readonly flow: FlowDefinition,
    private readonly log: OperatorLog,
  ) {
    this.funnel = new FunnelRules(catalog);
  }

  @Get('not-eligible')
  async show(@Req() req: Request, @Res() res: Response): Promise<void> {
    const state = this.journeyStoreFactory.get().currentState();

    res.render('pages/not-eligible', {
      noindex: true,
      reason: await this.reason(),
      treatment: this.treatmentName(),
      back_path: this.flow.pathFor(await this.stepOfVerdict()),
      disqualified: state !== null && state.isDisqualified(),
    });
  }

  /**
   * Clears the verdict and the answers behind it, drops the line that triggered it, and sends the
   * visitor back to browse. A POST because it destroys state.
   */
  @Post('intake/start-over')
  async startOver(@Req() req: Request, @Res() res: Response): Promise<void> {
    const state = this.journeyStoreFactory.get().currentState();
    const teleformId = state?.disqualifiedTeleform ?? null;

    if (state !== null) {
      state.clearDisqualification();

      if (teleformId !== null) {
        state.storeAnswers(teleformId, {});
        delete state.formStatus[teleformId];
      }
    }

    await this.clearTriggeringLine(req, teleformId);

    res.redirect(303, this.flow.pathFor('home'));
  }

  /**
   * Removes the prescription the disqualification was about, leaving any independently purchasable
   * line behind (`[10.47]`) — and, with several prescriptions in the cart, every one the stop was
   * not about.
   *
   * The verdict is read before {@link NotEligibleController.startOver} clears it, so the form that
   * produced it is passed in.
   */
  private async clearTriggeringLine(req: Request, teleformId: string | null): Promise<void> {
    let cart;
    try {
      cart = this.cartStoreFactory.get().currentCart();
    } catch (e) {
      this.log.warning('intake.start_over_cart_unavailable', { exception: e instanceof Error ? e.constructor.name : 'unknown' });
      return;
    }

    const rx = this.funnel.prescriptionStoppedBy(cart, teleformId);
    if (rx === null) return;

    this.rules.remove(cart, rx.slug);
    this.cartStoreFactory.get().save(cart);
    await this.mirror.mirror((req as { sessionUuid?: string | null }).sessionUuid ?? null, cart, this.journeyStoreFactory.get().currentState());
  }

  /**
   * Which questionnaire to send the visitor back to. The verdict may have come from the
   * eligibility form rather than the medical one, and sending someone back to a form they have
   * not reached would strand them in front of questions that cannot change the answer that
   * stopped them.
   */
  private async stepOfVerdict(): Promise<string> {
    const state = this.journeyStoreFactory.get().currentState();
    const teleformId = state?.disqualifiedTeleform ?? null;
    if (teleformId === null) return 'intake.medical';

    let cart;
    try {
      cart = this.cartStoreFactory.get().currentCart();
    } catch {
      return 'intake.medical';
    }

    return this.funnel.collectedAtPrequalification(teleformId, cart) ? 'prequalification' : 'intake.medical';
  }

  /** The authored wording for the rule that fired, or null when this page was reached without a verdict. */
  private async reason(): Promise<string | null> {
    const state = this.journeyStoreFactory.get().currentState();
    if (state === null || !state.isDisqualified()) return null;

    const teleformId = state.disqualifiedTeleform;
    if (teleformId === null) return null;

    let definition: Definition;
    try {
      definition = Definition.fromArray(await this.source.definitionFor(teleformId));
    } catch (e) {
      // The verdict stands whether or not its wording can be fetched — only the explanation is
      // lost, so the page falls back to its own copy.
      if (e instanceof FormUnavailable) return null;
      throw e;
    }

    for (const rule of this.disqualification.rulesFor(teleformId, definition)) {
      if (rule.id === state.disqualifiedRule) return rule.message;
    }

    return null;
  }

  private treatmentName(): string | null {
    try {
      const cart = this.cartStoreFactory.get().currentCart();
      const teleformId = this.journeyStoreFactory.get().currentState()?.disqualifiedTeleform ?? null;
      return this.funnel.prescriptionStoppedBy(cart, teleformId)?.name ?? null;
    } catch {
      return null;
    }
  }
}
