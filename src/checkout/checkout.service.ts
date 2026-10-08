import { createHash } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';
import { CHECKOUT_EVENT_REPORTER, EMR_VERIFICATION_GATEWAY, ORDER_RECORDER, PAYMENT_ADAPTER, PRODUCT_CATALOG } from '../core/tokens';
import { Cart } from '../domain/cart';
import { CartLine } from '../domain/cart-line';
import { CartOutcome } from '../domain/cart-outcome';
import { CartRules } from '../domain/cart-rules';
import { ProductCatalog, ProductVariant } from '../domain/product-catalog';
import { VerificationGateway } from '../emr/verification-gateway';
import { TeleformSource } from '../forms/teleform-source';
import { AnswerSet } from '../forms/answer-set';
import { Definition } from '../forms/definition';
import { FlowDefinition } from '../funnel/flow-definition';
import { FurthestStep } from '../funnel/furthest-step';
import { CartStoreFactory } from '../journey/cart-store-factory';
import { JourneyState } from '../journey/journey-state';
import { JourneyStoreFactory } from '../journey/journey-store-factory';
import { CardDescriptor } from '../payment/card-descriptor';
import { OrderEnvelope } from '../payment/order-envelope';
import { OrderLine } from '../payment/order-line';
import { PaymentAdapter } from '../payment/payment-adapter';
import { PaymentCredential } from '../payment/payment-credential';
import { PaymentDescriptor } from '../payment/payment-descriptor';
import { PlacementOutcome } from '../payment/placement-outcome';
import { SettlementMode, SettlementModeValue } from '../payment/settlement-mode';
import { CardScrubber } from '../support/card-scrubber';
import { ConfigService } from '../support/config';
import { DatabaseRateLimiter } from '../support/database-rate-limiter';
import { OperatorLog } from '../support/operator-log';
import { RequestContext } from '../support/request-context';
import { Upsells } from '../upsell/upsells';
import { BuyerDetails } from './buyer-details';
import { BuyerValidator } from './buyer-validator';
import { CardNumber } from './card-number';
import { CheckoutAttempt } from './checkout-attempt';
import { CheckoutAttemptRepository, CheckoutAttemptTakenOver } from '../repository/checkout-attempt-repository';
import { CheckoutEventReporter } from './checkout-event-reporter';
import { CheckoutResult } from './checkout-result';
import { CheckoutBumpViewModel, CheckoutLineViewModel, CheckoutPlanViewModel, CheckoutViewModel } from './checkout-view-model';
import { ConsentRecord } from './consent-record';
import { Consents } from './consents';
import { IdempotencyKey } from './idempotency-key';
import { OrderBumps } from './order-bumps';
import { OrderRecorder } from './order-recorder';
import { PostChargeGuard } from './post-charge-guard';
import { Prefill } from './prefill';
import { Promotion } from './promotion';
import { SettlementPolicy } from './settlement-policy';
import { Totals } from './totals';

/** Local event-name vocabulary for `JourneyState.emrEvents`'s dedup marker — inert while `CHECKOUT_EVENT_REPORTER` is Null-only. */
const CHECKOUT_VISITED_EVENT = 'checkout_visited';
const ORDER_DECLINED_EVENT = 'order_declined';

/**
 * Ported from storefront-lamp/core/Checkout/CheckoutService.php. The checkout page's whole decision
 * surface: what to render, and what happens when it is submitted.
 *
 * The **order of operations inside `submit()` is the specification's, not a convenience**, and
 * getting it wrong is silent. In order: refuse a flood before anything costs money (`[13.8]`);
 * re-price a stored discount code against the cart actually in hand (`[13.11]`, `[14.6b]`); validate
 * the buyer (`[13.5]`) and record the consents (`[26.5]`); re-run the geo gate against the freshly
 * submitted territory (`[13.6]`, `[13.7]`); store the buyer *before* the provider call (`[13.30]`);
 * claim the idempotency key (`[13.37]`); assemble one envelope for the whole cart (`[13.19]`); mark
 * the attempt sent; place it; and only then, on success, run `[13.32]`'s sequence.
 *
 * **Past the charge that reverses completely.** Once `PaymentAdapter.place()` has returned, the
 * money may have moved, and from that point no failure of ours may reach the buyer as a failure —
 * every write after the call runs inside `PostChargeGuard.run()`.
 *
 * **The card passes through and is never kept.** It arrives as a `PaymentCredential` and is handed
 * to the adapter, and that is the end of it — nothing here writes it anywhere, and no field of
 * `JourneyState` carries it past this request.
 */
@Injectable()
export class CheckoutService {
  static readonly CONSENT_REQUIRED = 'Please agree to this to continue.';
  static readonly CORRECTIONS_NEEDED = 'Please correct the highlighted fields and try again.';
  static readonly RATE_LIMITED_NOTICE = 'Too many checkout attempts from this connection. Please wait a few minutes and try again.';
  static readonly IN_FLIGHT_NOTICE = 'Your order is being processed. Please wait a moment before submitting again.';
  static readonly CONFIRMING_NOTICE =
    'Your payment is being confirmed. Please wait a moment and reload this page rather than submitting again — your card may already have been charged.';
  static readonly UNRECORDABLE_NOTICE = 'We could not start your order just now. Please try again in a moment.';
  static readonly PROMOTION_DROPPED_NOTICE = 'Your discount code no longer applies to your order, so it has been removed. Please review your total.';
  static readonly PROMOTION_REPRICED_NOTICE = 'Your order changed, so your discount has been recalculated. Please review your total before paying.';
  static readonly UNAVAILABLE_LINE = 'One of the items in your order is not available for purchase right now. Please remove it and try again.';
  static readonly PENDING_ACTION_NOTICE =
    'Your payment could not be completed: your bank asked for an extra verification step this checkout cannot yet handle. Please try a different card, or contact support quoting reference %s.';

  private static readonly PAYMENT_METHOD = 'card';
  private static readonly CHECKOUT_STEP = 'checkout';
  private static readonly DEFAULT_STALE_AFTER_SECONDS = 120;

  private readonly clock: () => string;

  constructor(
    private readonly cartStoreFactory: CartStoreFactory,
    private readonly journeyStoreFactory: JourneyStoreFactory,
    private readonly rules: CartRules,
    @Inject(PRODUCT_CATALOG) private readonly catalog: ProductCatalog,
    @Inject(PAYMENT_ADAPTER) private readonly adapter: PaymentAdapter,
    private readonly consents: Consents,
    private readonly bumps: OrderBumps,
    @Inject(EMR_VERIFICATION_GATEWAY) private readonly verification: VerificationGateway,
    private readonly attempts: CheckoutAttemptRepository,
    private readonly limiter: DatabaseRateLimiter,
    @Inject(ORDER_RECORDER) private readonly orders: OrderRecorder,
    @Inject(CHECKOUT_EVENT_REPORTER) private readonly events: CheckoutEventReporter,
    private readonly forms: TeleformSource,
    private readonly flow: FlowDefinition,
    private readonly config: ConfigService,
    private readonly log: OperatorLog,
    private readonly postCharge: PostChargeGuard,
    private readonly upsells: Upsells,
    private readonly settlement: SettlementPolicy,
    @Inject(REQUEST) private readonly request: Request,
    @Optional() clock?: () => string,
  ) {
    this.clock = clock ?? (() => new Date().toISOString());
  }

  /**
   * Everything the page renders. `submitted`, when present, **overrides prefill entirely** rather
   * than merging under it (`[13.30]`) — an intake answer winning over a correction typed at checkout
   * would silently undo the correction the buyer is retrying with.
   */
  async view(submitted: BuyerDetails | null = null, errors: Record<string, string> = {}, notice: string | null = null): Promise<CheckoutViewModel> {
    const cartStore = this.cartStoreFactory.get();
    const journeyStore = this.journeyStoreFactory.get();
    const cart = cartStore.currentCart();
    const state = journeyStore.currentState();

    const [promotion, repriced] = await this.repricePromotion(cart, state);
    const totals = Totals.of(cart.subtotalCents(), promotion);

    const resolvedNotice = notice ?? repriced;

    let prefill = await this.prefill(cart, state);
    if (submitted !== null) {
      prefill = { ...prefill, ...submitted.toArray() };
    }

    if (state === null || !state.hasEmrEvent(CHECKOUT_VISITED_EVENT)) {
      await this.events.checkoutVisited(journeyStore.sessionUuid(), totals);
      state?.recordEmrEvent(CHECKOUT_VISITED_EVENT);
    }

    const plans = this.planViewModels(cart);

    return new CheckoutViewModel(
      prefill,
      errors,
      resolvedNotice,
      totals,
      this.lineViewModels(cart),
      this.bumpViewModels(cart, prefill.territory ?? ''),
      plans[0] ?? null,
      this.consents.definitions(),
      this.adapter.capabilities(),
      promotion,
      this.currency(),
      cart.itemCount(),
      plans,
      cart.rxLines().length > 1,
    );
  }

  /** One checkout submission, all the way to a placed order or a stated reason why not. */
  async submit(buyer: BuyerDetails, credential: PaymentCredential, consents: Record<string, unknown>, context: RequestContext | null = null): Promise<CheckoutResult> {
    const cartStore = this.cartStoreFactory.get();
    const journeyStore = this.journeyStoreFactory.get();
    const cart = cartStore.currentCart();
    const state = journeyStore.currentState();

    let totals = Totals.of(cart.subtotalCents(), Promotion.fromArray(state?.promotion ?? null));

    // 1. `[13.8]`: before anything costs money, and before the buyer's details are even looked at.
    if (!(await this.limiter.allow('checkout.submit', this.rateLimitIdentity(context)))) {
      this.log.info('checkout.rate_limited', {});
      return this.refusal(totals, CheckoutResult.REFUSED_RATE_LIMITED, CheckoutService.RATE_LIMITED_NOTICE);
    }

    // The submission that arrives after the order it is for was already placed.
    const alreadyPlaced = cart.isEmpty() ? (state?.placedOrders ?? []) : [];
    if (alreadyPlaced.length > 0) {
      const reference = alreadyPlaced[alreadyPlaced.length - 1];
      this.log.info('checkout.already_placed', { reference });
      return new CheckoutResult(PlacementOutcome.placed(reference), totals, {}, null, this.onwardPath());
    }

    // 1b. `[13.11]`, `[14.6b]`: re-priced before validation, so every total below is the fresh one.
    const [promotion, repriced] = await this.repricePromotion(cart, state);
    totals = Totals.of(cart.subtotalCents(), promotion);

    if (repriced !== null) {
      return new CheckoutResult(PlacementOutcome.declined(null, repriced, 'promotion_repriced'), totals, {}, repriced);
    }

    // 2. `[13.5]` and `[26.5]`: both collected before either is reported.
    const errors = await BuyerValidator.validate(buyer, this.verification);
    const recorded = this.consents.record(consents);
    for (const key of recorded.missing) {
      errors[key] = CheckoutService.CONSENT_REQUIRED;
    }

    if (credential.kind === PaymentCredential.KIND_CARD) {
      const problem = CardNumber.problem(credential.number ?? '');
      if (problem !== null) errors.card_number = problem;
    }

    if (Object.keys(errors).length > 0) {
      return new CheckoutResult(PlacementOutcome.declined(null, CheckoutService.CORRECTIONS_NEEDED, 'validation_failed'), totals, errors);
    }

    // 3. `[13.6]`, `[13.7]`: re-run against the freshly submitted territory across every line.
    const geo = this.rules.applyTerritory(cart, buyer.territory);
    if (!geo.accepted) {
      return new CheckoutResult(PlacementOutcome.declined(null, geo.notice ?? '', 'geo_blocked'), totals, {}, geo.notice);
    }
    cartStore.save(cart);

    // 4. `[13.30]`: stored before the provider is called, so a decline still re-fills the form.
    state?.storeBuyer(buyer.toArray());
    if (state !== null) {
      state.consents = recorded.records.map((record) => record.toArray() as JourneyState['consents'][number]);
    }

    // 5. `[13.37]`: the claim, and the sent marker below it, are the last two things that can fail
    //    before money moves.
    const key = IdempotencyKey.forSubmit(journeyStore.sessionUuid(), this.sessionKey(), cart, buyer.toArray());

    let claimedAt: string | null;
    try {
      claimedAt = await this.claim(key);
    } catch (error) {
      this.log.error('checkout.attempt_unrecordable', { reason: CardScrubber.scrub(error instanceof Error ? error.message : String(error)) });
      return this.refusal(totals, CheckoutResult.REFUSED_UNRECORDABLE, CheckoutService.UNRECORDABLE_NOTICE);
    }

    if (claimedAt === null) {
      return this.duplicate(key, totals);
    }

    // 6. `[13.19]`–`[13.23]`: one order for the whole cart.
    const lines = this.orderLines(cart);
    for (const line of lines) {
      if (line.isChargeable() || line.isFree()) continue;

      await this.releaseQuietly(key, claimedAt);
      this.log.error('checkout.priced_line_unmapped', { slug: line.slug });

      return new CheckoutResult(
        PlacementOutcome.declined(null, CheckoutService.UNAVAILABLE_LINE, 'priced_line_unmapped'),
        totals,
        {},
        CheckoutService.UNAVAILABLE_LINE,
      );
    }

    const envelope = new OrderEnvelope(
      lines,
      buyer.toBuyer(),
      totals.subtotalCents,
      totals.discountCents,
      totals.totalCents,
      this.currency(),
      promotion?.code ?? null,
      state?.attribution?.params ?? {},
      journeyStore.sessionUuid(),
      context?.clientIp ?? null,
      context?.userAgent ?? null,
      key,
      CheckoutService.anchorSlug(cart),
      this.settlement.forSlugs(...cart.lines().map((line) => line.slug)),
    );

    // 6b. The provider has to be able to honour the settlement mode this order resolved to.
    if (SettlementMode.isAuthorize(envelope.settlement) && !this.adapter.capabilities().supportsAuthorizeCapture) {
      await this.releaseQuietly(key, claimedAt);
      this.log.error('checkout.settlement_unsupported', {
        provider: this.adapter.capabilities().providerCategory,
        settlement: envelope.settlement,
        anchor: envelope.anchorSlug,
      });

      return new CheckoutResult(PlacementOutcome.declined(null, CheckoutService.UNAVAILABLE_LINE, 'settlement_unsupported'), totals, {}, CheckoutService.UNAVAILABLE_LINE);
    }

    // 7. Written before the call rather than after it — the width of one network round trip is all
    //    it takes for a request that dies mid-charge to invite a stale-takeover replay.
    try {
      await this.attempts.markSent(key, claimedAt);
    } catch (error) {
      if (error instanceof CheckoutAttemptTakenOver) {
        this.log.warning('checkout.attempt_taken_over', {
          idempotency_key: key,
          session_uuid: journeyStore.sessionUuid(),
          amount_cents: totals.totalCents,
          reason: error.message,
        });
        return this.duplicate(key, totals);
      }

      this.log.error('checkout.attempt_unrecordable', { reason: CardScrubber.scrub(error instanceof Error ? error.message : String(error)) });
      await this.releaseQuietly(key, claimedAt);
      return this.refusal(totals, CheckoutResult.REFUSED_UNRECORDABLE, CheckoutService.UNRECORDABLE_NOTICE);
    }

    // 8. The adapter never throws for a provider-side outcome. Everything below this line is past
    //    the point of no return.
    const outcome = await this.adapter.place(envelope, credential);
    await this.settleAttempt(key, claimedAt, outcome, totals);

    if (outcome.state === PlacementOutcome.PENDING_ACTION) {
      // 9. The key is deliberately NOT released — the provider has already created an order.
      return this.stopped(
        state,
        totals,
        outcome,
        CheckoutService.PENDING_ACTION_NOTICE.replace('%s', outcome.reference ?? ''),
        CheckoutService.paymentDescriptor(credential, envelope.settlement, outcome, totals, false),
      );
    }

    if (!outcome.isPlaced()) {
      // 10. `[13.30]`: cart intact, buyer on checkout, the provider's own reason shown verbatim.
      return this.stopped(state, totals, outcome, outcome.reason, CheckoutService.paymentDescriptor(credential, envelope.settlement, outcome, totals, false));
    }

    return this.placed(state, cart, envelope, outcome, credential, totals, recorded.records);
  }

  /** Accepts or withdraws one order bump (`[27.1]`, `[27.11]`). */
  async toggleBump(slug: string): Promise<CartOutcome> {
    const cartStore = this.cartStoreFactory.get();
    const journeyStore = this.journeyStoreFactory.get();
    const cart = cartStore.currentCart();
    const state = journeyStore.currentState();

    if ((state?.acceptedBumps ?? []).includes(slug) && cart.has(slug)) {
      const outcome = this.rules.remove(cart, slug);
      if (outcome.accepted && state !== null) {
        state.acceptedBumps = state.acceptedBumps.filter((accepted) => accepted !== slug);
        cartStore.save(cart);
        await this.events.orderBump(journeyStore.sessionUuid(), slug, false);
      }
      return outcome;
    }

    const bump = this.bumps.offeredFor(cart, this.territoryFor(cart, state)).find((candidate) => candidate.slug === slug) ?? null;
    if (bump === null) {
      return CartOutcome.rejected(CartRules.UNKNOWN_PRODUCT);
    }

    const outcome = this.rules.add(cart, bump.slug, bump.variantId);
    if (!outcome.accepted) return outcome;

    // `[27.12]`: the reduced price applies to this line and does not alter the catalog.
    const line = cart.line(bump.slug);
    if (line !== null) {
      line.unitPriceCents = bump.priceCents();
    }

    if (state !== null && !state.acceptedBumps.includes(bump.slug)) {
      state.acceptedBumps.push(bump.slug);
    }
    cartStore.save(cart);

    await this.events.orderBump(journeyStore.sessionUuid(), bump.slug, true);

    return outcome;
  }

  /** Prices a discount code against the current cart and stores what the provider said (`[13.11]`, `[13.13]`). */
  async applyPromotion(code: string, context: RequestContext | null = null): Promise<CartOutcome> {
    if (!this.adapter.capabilities().supportsPromotions) {
      return CartOutcome.rejected('Discount codes are not available.');
    }

    if (!(await this.limiter.allow('checkout.promo', this.rateLimitIdentity(context)))) {
      return CartOutcome.rejected(CheckoutService.RATE_LIMITED_NOTICE);
    }

    const cartStore = this.cartStoreFactory.get();
    const journeyStore = this.journeyStoreFactory.get();
    const cart = cartStore.currentCart();
    const state = journeyStore.currentState();
    const promotion = await this.quoteAgainst(cart, state, code);

    if (promotion === null) {
      return CartOutcome.rejected('That discount code could not be applied.');
    }

    this.storePromotion(state, cart, promotion);

    return CartOutcome.accepted(`Discount code ${promotion.code} applied.`);
  }

  /** `[13.13]`: removing the code removes the discount, and nothing else. */
  removePromotion(): void {
    this.storePromotion(this.journeyStoreFactory.get().currentState(), null, null);
  }

  /** `[12.4]`, `[12.7]`: choosing a plan is what gives an Rx line a price. */
  choosePlan(slug: string, variantId: string): CartOutcome {
    const cartStore = this.cartStoreFactory.get();
    const cart = cartStore.currentCart();
    const outcome = this.rules.chooseVariant(cart, slug, variantId);

    if (outcome.accepted) {
      cartStore.save(cart);
    }

    return outcome;
  }

  /** Keeps what the buyer has typed, so a sub-action does not cost them the form (`[27.10]`). */
  rememberBuyer(buyer: BuyerDetails): void {
    this.journeyStoreFactory.get().currentState()?.storeBuyer(buyer.toArray());
  }

  /** `[13.32]`, in its own order. */
  private async placed(
    state: JourneyState | null,
    cart: Cart,
    envelope: OrderEnvelope,
    outcome: PlacementOutcome,
    credential: PaymentCredential,
    totals: Totals,
    consents: ConsentRecord[],
  ): Promise<CheckoutResult> {
    const reference = outcome.reference ?? '';
    const cartStore = this.cartStoreFactory.get();
    const journeyStore = this.journeyStoreFactory.get();

    // 2. Cleared in both the working copy and the durable one.
    await this.postCharge.run('clear_cart', reference, () => cartStore.save(new Cart()));

    if (state !== null) {
      // 3. `[13.17]`: dropped so it cannot bleed into the upsell flow.
      state.promotion = null;
      state.promotionQuotedAgainst = null;
      state.acceptedBumps = [];
      state.cartMirrored = false;

      // 4. What survives to pay for an upsell is the handle the provider issued, never the card.
      const reusable = outcome.reusableCredential;
      await this.postCharge.run('store_reusable_credential', reference, () => {
        if (reusable !== null && !reusable.isReusable()) return;
        state.storeReusableCredential(reusable);
      });

      // 5. `[16.1]`, `[16.2]`: the queue is built from what was just bought, once, here.
      state.upsellQueue = this.upsells.queueFor(CheckoutService.purchasedSlugs(cart));
      state.upsellCursor = 0;
      state.upsellOutcomes = {};
      state.upsellQuotes = {};

      // 6. The server-side half of the "order placed" signal.
      state.recordPlacedOrder(reference);

      // 7. `[21.7]`: paying for checkout is what completes it.
      FurthestStep.advance(state, CheckoutService.CHECKOUT_STEP);
    }

    await this.postCharge.run('record_order', reference, () => this.orders.record(envelope, outcome, credential, consents, this.adapter.capabilities().providerCategory));
    await this.postCharge.run('report_order_placed', reference, () =>
      this.events.orderPlaced(journeyStore.sessionUuid(), totals, CheckoutService.PAYMENT_METHOD, [reference], CheckoutService.paymentDescriptor(credential, outcome.settlement, outcome, totals, true)),
    );

    this.log.info('checkout.order_placed', { reference, anchor: envelope.anchorSlug });

    if (journeyStore.sessionUuid() === null) {
      this.log.info('checkout.placed_without_session', { reference });
    }

    return new CheckoutResult(outcome, totals, {}, null, this.onwardPath());
  }

  /**
   * How this order was paid for, for the reporting boundary. **The settlement is the argument, not
   * `outcome.settlement`** — a decline carries none, so reading it off the outcome would report
   * every refused authorization as an attempt to charge.
   */
  private static paymentDescriptor(
    credential: PaymentCredential,
    settlement: SettlementModeValue,
    outcome: PlacementOutcome,
    totals: Totals,
    held: boolean,
  ): PaymentDescriptor {
    const authorize = SettlementMode.isAuthorize(settlement);

    return new PaymentDescriptor(
      PaymentDescriptor.TYPE_CREDIT_CARD,
      authorize,
      outcome.preAuthQa,
      held && authorize ? totals.totalCents : null,
      CardDescriptor.fromCredential(credential, outcome.providerCardBrand),
    );
  }

  /** A decline or a challenge: the buyer stays on checkout with the cart untouched, and the card they typed is forgotten (`[15.8]`). */
  private async stopped(state: JourneyState | null, totals: Totals, outcome: PlacementOutcome, notice: string | null, payment: PaymentDescriptor | null = null): Promise<CheckoutResult> {
    state?.wipePaymentCredential();
    state?.recordEmrEvent(ORDER_DECLINED_EVENT);

    const journeyStore = this.journeyStoreFactory.get();
    await this.postCharge.run('report_order_declined', outcome.reference, () =>
      this.events.orderDeclined(journeyStore.sessionUuid(), totals, CheckoutService.PAYMENT_METHOD, outcome.reference, outcome.reason ?? outcome.rawStatus ?? '', payment),
    );

    return new CheckoutResult(outcome, totals, {}, notice === null ? null : (CardScrubber.scrub(notice) as string));
  }

  /** Someone else holds this key. */
  private async duplicate(key: string, totals: Totals): Promise<CheckoutResult> {
    const row = await this.attempts.outcomeFor(key);
    const attempt = row === null ? null : CheckoutAttempt.fromRow(row);

    if (attempt !== null && attempt.isComplete() && attempt.outcome !== null) {
      const stored = attempt.outcome;
      this.log.info('checkout.duplicate_replayed', { ...this.reconcilable(key, totals, stored.reference, CheckoutAttemptRepository.STATE_COMPLETE), replayed_state: stored.state });

      const notice = stored.isPlaced() ? null : stored.state === PlacementOutcome.PENDING_ACTION ? CheckoutService.PENDING_ACTION_NOTICE.replace('%s', stored.reference ?? '') : stored.reason;

      return new CheckoutResult(stored, totals, {}, notice, stored.isPlaced() ? this.onwardPath() : null);
    }

    if (attempt !== null && attempt.isSent()) {
      this.log.warning('checkout.duplicate_confirming', this.reconcilable(key, totals, attempt.outcome?.reference ?? null, CheckoutAttemptRepository.STATE_SENT));
      return this.refusal(totals, CheckoutResult.REFUSED_IN_FLIGHT, CheckoutService.CONFIRMING_NOTICE);
    }

    this.log.info('checkout.duplicate_in_flight', this.reconcilable(key, totals, null, attempt?.state ?? 'absent'));
    return this.refusal(totals, CheckoutResult.REFUSED_IN_FLIGHT, CheckoutService.IN_FLIGHT_NOTICE);
  }

  /** Records what the provider said against the attempt, in the one way that is safe for the outcome in hand. */
  private async settleAttempt(key: string, claimedAt: string, outcome: PlacementOutcome, totals: Totals): Promise<void> {
    if (CheckoutAttempt.releasesKey(outcome)) {
      await this.releaseQuietly(key, claimedAt);
      return;
    }

    if (!outcome.isPlaced() && outcome.state !== PlacementOutcome.PENDING_ACTION) {
      this.log.error('checkout.attempt_unresolved', {
        ...this.reconcilable(key, totals, outcome.reference, CheckoutAttemptRepository.STATE_SENT),
        raw_status: outcome.rawStatus,
        reason: 'the provider never answered, so the key is kept and no outcome is stored',
      });
      return;
    }

    await this.postCharge.run('record_outcome', outcome.reference, () => this.attempts.recordOutcome(key, CheckoutAttempt.encodeOutcome(outcome)));
  }

  private reconcilable(key: string, totals: Totals, reference: string | null, attemptState: string): Record<string, unknown> {
    return {
      idempotency_key: key,
      session_uuid: this.journeyStoreFactory.get().sessionUuid(),
      amount_cents: totals.totalCents,
      reference,
      attempt_state: attemptState,
    };
  }

  /** Gives the key back without letting a failed attempt to do so become the failure the buyer sees. */
  private async releaseQuietly(key: string, claimedAt: string): Promise<void> {
    try {
      await this.attempts.release(key, claimedAt);
    } catch (error) {
      this.log.error('checkout.attempt_not_released', { reason: CardScrubber.scrub(error instanceof Error ? error.message : String(error)) });
    }
  }

  /** Claims the key, taking over a claim old enough to have been abandoned. Only a `claimed` row is ever eligible, however old it is. */
  private async claim(key: string): Promise<string | null> {
    const now = this.clock();

    if (await this.attempts.claim(key, this.sessionKey(), now)) {
      return now;
    }

    const row = await this.attempts.outcomeFor(key);
    if (row === null || row.state !== CheckoutAttemptRepository.STATE_CLAIMED) {
      return null;
    }

    const age = (Date.parse(now) - Date.parse(row.createdAt)) / 1000;
    if (age < this.staleAfterSeconds()) {
      return null;
    }

    if (!(await this.attempts.renewClaim(key, this.sessionKey(), now, row.createdAt))) {
      return null;
    }

    this.log.warning('checkout.stale_attempt_reclaimed', { idempotency_key: key, session_uuid: this.journeyStoreFactory.get().sessionUuid(), age_seconds: age });

    return now;
  }

  /** A refusal the buyer cannot fix by editing the form. */
  private refusal(totals: Totals, because: string, notice: string): CheckoutResult {
    return new CheckoutResult(PlacementOutcome.declined(null, notice, because), totals, {}, notice, null, because);
  }

  /** Where a placed order sends the buyer: the upsell step when the flow declares one, the receipt otherwise. */
  private onwardPath(): string {
    for (const step of ['upsell', 'receipt']) {
      if (this.flow.allSteps()[step] !== undefined) {
        return this.flow.pathFor(step);
      }
    }
    return this.flow.pathFor(FlowDefinition.ENTRY_STEP);
  }

  /** The cart as provider-neutral order lines. */
  private orderLines(cart: Cart): OrderLine[] {
    return cart.lines().map((line) => {
      const provider = this.providerIdentifiers(line);
      return new OrderLine(line.slug, line.name, provider.offer_id ?? null, provider.product_id ?? null, line.unitPriceCents, line.quantity, line.kind);
    });
  }

  private providerIdentifiers(line: CartLine): { offer_id?: string; product_id?: string } {
    const variant = this.variantFor(line.slug, line.variantId);
    return variant?.provider ?? {};
  }

  /** The chosen variant, or the first one when nothing was chosen. */
  private variantFor(slug: string, variantId: string | null): ProductVariant | null {
    const product = this.catalog.product(slug);
    const variants = product?.variants ?? [];
    if (variants.length === 0) return null;

    if (variantId === null || variantId === '') return variants[0];

    return variants.find((v) => v.id === variantId) ?? variants[0];
  }

  /** The promotion that may be shown and charged against the cart in hand. */
  private async repricePromotion(cart: Cart, state: JourneyState | null): Promise<[Promotion | null, string | null]> {
    const stored = Promotion.fromArray(state?.promotion ?? null);
    if (stored === null || state === null) {
      return [stored, null];
    }

    const scope = CheckoutService.promotionScope(this.orderLines(cart));
    if (state.promotionQuotedAgainst === scope) {
      return [stored, null];
    }

    const fresh = await this.quoteAgainst(cart, state, stored.code);

    if (fresh === null) {
      this.storePromotion(state, cart, null);
      this.log.info('checkout.promotion_dropped', { code: stored.code });
      return [null, CheckoutService.PROMOTION_DROPPED_NOTICE];
    }

    this.storePromotion(state, cart, fresh);

    if (fresh.discountCents === stored.discountCents) {
      return [fresh, null];
    }

    this.log.info('checkout.promotion_repriced', { code: fresh.code, was_discount_cents: stored.discountCents, now_discount_cents: fresh.discountCents });

    return [fresh, CheckoutService.PROMOTION_REPRICED_NOTICE];
  }

  /** One read-only quote of a code against one cart, or null when the code does not price against it. */
  private async quoteAgainst(cart: Cart, state: JourneyState | null, code: string): Promise<Promotion | null> {
    if (!this.adapter.capabilities().supportsPromotions) return null;

    const quote = await this.adapter.quotePromotion(this.quoteEnvelope(cart, state), code);

    if (!quote.accepted) {
      this.log.info('checkout.promotion_rejected', { reason: quote.reason });
      return null;
    }

    if (quote.discountCents > cart.subtotalCents()) {
      this.log.warning('checkout.promotion_exceeds_cart', { code: quote.code, discount_cents: quote.discountCents, subtotal_cents: cart.subtotalCents() });
      return null;
    }

    return new Promotion(quote.code, quote.discountCents);
  }

  /** Stores a promotion together with the cart it is an answer about, or clears both. */
  private storePromotion(state: JourneyState | null, cart: Cart | null, promotion: Promotion | null): void {
    if (state === null) return;

    state.promotion = promotion?.toArray() ?? null;
    state.promotionQuotedAgainst = promotion === null || cart === null ? null : CheckoutService.promotionScope(this.orderLines(cart));
  }

  /** A digest of exactly what a quote is computed from. */
  private static promotionScope(lines: OrderLine[]): string {
    const material = lines.filter((line) => line.isChargeable()).map((line) => [line.providerOffer, line.providerItem, line.unitPriceCents, line.quantity]);
    return createHash('sha256').update(JSON.stringify(material)).digest('hex');
  }

  /** A cheap envelope for pricing a discount code. */
  private quoteEnvelope(cart: Cart, state: JourneyState | null): OrderEnvelope {
    const buyer = new BuyerDetails(CheckoutService.buyerArguments(state?.buyer ?? {}));
    const totals = Totals.of(cart.subtotalCents(), null);

    return new OrderEnvelope(
      this.orderLines(cart),
      buyer.toBuyer(),
      totals.subtotalCents,
      0,
      totals.totalCents,
      this.currency(),
      null,
      {},
      this.journeyStoreFactory.get().sessionUuid(),
      null,
      null,
      '',
      CheckoutService.anchorSlug(cart),
    );
  }

  private static buyerArguments(stored: Record<string, string>): Record<string, string> {
    return {
      firstName: stored.first_name ?? '',
      lastName: stored.last_name ?? '',
      email: stored.email ?? '',
      phone: stored.phone ?? '',
      addressLine: stored.address_line ?? '',
      city: stored.city ?? '',
      territory: stored.territory ?? '',
      postalCode: stored.postal_code ?? '',
    };
  }

  /**
   * The order's anchor: the first prescription added if there is one (`[8.0f]` allows several),
   * otherwise the first thing the buyer chose for themselves.
   */
  private static anchorSlug(cart: Cart): string {
    const rx = cart.rxLines()[0] ?? null;
    if (rx !== null) return rx.slug;

    for (const line of cart.lines()) {
      if (!line.isChild()) return line.slug;
    }

    return '';
  }

  /** Every slug this order contained, which is what the upsell queue is built from (`[16.1]`). */
  private static purchasedSlugs(cart: Cart): string[] {
    return cart.lines().map((line) => line.slug);
  }

  /** The checkout fields this visitor should not have to type again (`[13.5b]`). */
  private async prefill(cart: Cart, state: JourneyState | null): Promise<Record<string, string>> {
    const working = state?.buyer ?? {};
    const teleformId = this.teleformIdFor(cart);

    if (teleformId === null || state === null) {
      return Prefill.from(null, null, null, working);
    }

    let metadata = null;
    let definition: Definition | null = null;
    try {
      metadata = await this.forms.metadataFor(teleformId);
      if (metadata !== null) {
        definition = Definition.fromArray(await this.forms.definitionFor(teleformId));
      }
    } catch (error) {
      this.log.warning('checkout.prefill_unavailable', { reason: error instanceof Error ? error.message : String(error) });
    }

    return Prefill.from(metadata, definition, metadata === null ? null : AnswerSet.fromArray(state.answersFor(teleformId)), working);
  }

  /**
   * `[8.3]`: the first line that declares a questionnaire — the form whose stored answers can
   * prefill checkout. A cart with two or more prescriptions collects none on the storefront
   * (`[8.0i]`), so this only finds answers given before the second one was added.
   */
  private teleformIdFor(cart: Cart): string | null {
    for (const line of cart.lines()) {
      const id = this.catalog.product(line.slug)?.teleform_id;
      if (typeof id === 'string' && id !== '') return id;
    }
    return null;
  }

  /** The cart in presentation shape, free attachments included at zero (`[7.14a]`). */
  private lineViewModels(cart: Cart): CheckoutLineViewModel[] {
    return cart.lines().map((line) => {
      const product = this.catalog.product(line.slug);
      const variant = this.variantFor(line.slug, line.variantId);

      return {
        slug: line.slug,
        name: line.name,
        quantity: line.quantity,
        unit_price_cents: line.unitPriceCents,
        line_total_cents: line.lineTotalCents(),
        variant_name: variant === null ? null : (variant.name ?? ''),
        image: typeof product?.image === 'string' ? product.image : null,
        is_free: line.unitPriceCents === 0,
        is_child: line.isChild(),
      };
    });
  }

  /** The offers this cart earns, in position order (§27). */
  private bumpViewModels(cart: Cart, territory: string): CheckoutBumpViewModel[] {
    return this.bumps.offeredFor(cart, territory).map((bump) => {
      const product = this.catalog.product(bump.slug);
      return {
        key: bump.key,
        slug: bump.slug,
        headline: bump.headline,
        body: bump.body,
        name: bump.name,
        price_cents: bump.priceCents(),
        catalog_price_cents: bump.catalogPriceCents,
        discounted: bump.priceCentsOverride !== null && bump.priceCentsOverride < bump.catalogPriceCents,
        image: typeof product?.image === 'string' ? product.image : null,
      };
    });
  }

  /**
   * One plan selector per Rx line, in cart order (`[8.0f]`); a prescription with no variants has
   * nothing to choose and gets none.
   */
  private planViewModels(cart: Cart): CheckoutPlanViewModel[] {
    const selectors: CheckoutPlanViewModel[] = [];
    for (const line of cart.rxLines()) {
      const selector = this.planViewModel(line);
      if (selector !== null) {
        selectors.push(selector);
      }
    }

    return selectors;
  }

  private planViewModel(line: CartLine): CheckoutPlanViewModel | null {
    const product = this.catalog.product(line.slug);
    const variants = product?.variants ?? [];
    if (variants.length === 0) return null;

    return {
      slug: line.slug,
      name: line.name,
      chosen: line.variantId,
      options: variants.map((variant) => ({ id: variant.id, name: variant.name, price_cents: variant.price_cents })),
    };
  }

  /** The territory the geo gate has already been applied with, or the one the buyer last told us. */
  private territoryFor(cart: Cart, state: JourneyState | null): string {
    return cart.shippingTerritory ?? state?.buyer.territory ?? '';
  }

  /** The identity the flood guard counts against — the client address when there is one (`[13.8]`, `[29.23]`). */
  private rateLimitIdentity(context: RequestContext | null): string {
    return context?.clientIp ?? `session:${this.sessionKey()}`;
  }

  /** The browser-scoped half of the idempotency key's material — the HTTP session id, not the analytics uuid. */
  private sessionKey(): string {
    return this.request.sessionID ?? '';
  }

  private currency(): string {
    return String(this.config.get('payment.currency', 'USD'));
  }

  private staleAfterSeconds(): number {
    const configured = this.config.get('payment.attempt_stale_after_seconds', CheckoutService.DEFAULT_STALE_AFTER_SECONDS);
    return typeof configured === 'number' && configured > 0 ? configured : CheckoutService.DEFAULT_STALE_AFTER_SECONDS;
  }
}
