import { Inject, Injectable, Optional } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';
import { CheckoutAttempt } from '../checkout/checkout-attempt';
import { CheckoutAttemptRepository, CheckoutAttemptTakenOver } from '../repository/checkout-attempt-repository';
import { CheckoutEventReporter } from '../checkout/checkout-event-reporter';
import { IdempotencyKey } from '../checkout/idempotency-key';
import { OrderRecorder } from '../checkout/order-recorder';
import { PostChargeGuard } from '../checkout/post-charge-guard';
import { SettlementPolicy } from '../checkout/settlement-policy';
import { CHECKOUT_EVENT_REPORTER, ORDER_RECORDER, PAYMENT_ADAPTER } from '../core/tokens';
import { FlowDefinition } from '../funnel/flow-definition';
import { FurthestStep } from '../funnel/furthest-step';
import { JourneyState } from '../journey/journey-state';
import { JourneyStoreFactory } from '../journey/journey-store-factory';
import { Buyer } from '../payment/buyer';
import { OrderEnvelope } from '../payment/order-envelope';
import { OrderLine } from '../payment/order-line';
import { PaymentAdapter } from '../payment/payment-adapter';
import { PaymentCredential } from '../payment/payment-credential';
import { PlacementOutcome } from '../payment/placement-outcome';
import { CardScrubber } from '../support/card-scrubber';
import { ConfigService } from '../support/config';
import { DatabaseRateLimiter } from '../support/database-rate-limiter';
import { OperatorLog } from '../support/operator-log';
import { RequestContext } from '../support/request-context';
import { Upsell } from './upsell';
import { UpsellQueue } from './upsell-queue';
import { UpsellResult } from './upsell-result';
import { UpsellViewModel } from './upsell-view-model';

/**
 * Ported from storefront-lamp/core/Upsell/UpsellService.php. The post-purchase upsell step: what to
 * render, and what happens when the buyer answers (§16).
 *
 * **A declined upsell is not a failure the buyer has to act on** (`[16.11]`). Everything below the
 * charge reports and advances rather than refusing, and `accept()` returns a redirect on every path
 * including the unhappy ones — the opposite of `CheckoutService.submit()`, which re-renders and
 * stops. At checkout the buyer has not bought anything yet; here they have, and trapping them on an
 * optional add-on would cost them the order they already completed.
 *
 * **The duplicate guard is the checkout's, not a second one.** An accepted upsell claims a row in
 * the same `checkout_attempts` table, with the same ownership-token discipline, and reuses
 * `CheckoutAttempt.releasesKey()` rather than re-deriving which provider statuses mean a charge
 * cannot be ruled out.
 *
 * **There is no promotion and nothing is re-quoted** (`[13.17]`) — the envelope always carries
 * `promotionCode: null`, `discountCents: 0`. **There is no stale-claim takeover, deliberately**: a
 * claim nobody finished blocks *that offer* for good rather than being retried, because the cost of
 * refusing forever is one optional add-on, not the order itself — and declining is one click away.
 */
@Injectable()
export class UpsellService {
  static readonly RATE_LIMITED_NOTICE = 'Too many attempts from this connection. Please wait a few minutes and try again.';
  static readonly CONFIRMING_NOTICE =
    'This add-on is still being confirmed. Please reload this page rather than submitting again — your card may already have been charged for it.';
  static readonly ACCEPT_PATH = '/upsell/accept/';
  static readonly DECLINE_PATH = '/upsell/decline/';
  static readonly PRICE_MOVED_NOTICE = 'The price of this offer changed while you were deciding. Please review it before adding it to your order.';
  static readonly OFFER_MOVED_NOTICE = 'That offer is no longer the one on screen. Here is your current offer.';
  static readonly UNQUOTED_NOTICE = 'We could not confirm this offer. Please take another look and try again.';

  private static readonly UPSELL_STEP = 'upsell';

  private readonly clock: () => string;

  constructor(
    private readonly journeyStoreFactory: JourneyStoreFactory,
    private readonly queue: UpsellQueue,
    @Inject(PAYMENT_ADAPTER) private readonly adapter: PaymentAdapter,
    private readonly attempts: CheckoutAttemptRepository,
    private readonly limiter: DatabaseRateLimiter,
    @Inject(ORDER_RECORDER) private readonly orders: OrderRecorder,
    @Inject(CHECKOUT_EVENT_REPORTER) private readonly events: CheckoutEventReporter,
    private readonly guard: PostChargeGuard,
    private readonly flow: FlowDefinition,
    private readonly config: ConfigService,
    private readonly log: OperatorLog,
    private readonly settlement: SettlementPolicy,
    @Inject(REQUEST) private readonly request: Request,
    @Optional() clock?: () => string,
  ) {
    this.clock = clock ?? (() => new Date().toISOString());
  }

  /**
   * The one offer to present now, or null when there is none (`[16.3]`, `[16.6]`) — null covers a
   * journey that does not exist, a queue never built, and a queue answered to the end.
   *
   * The offered event fires once per upsell (`[16.7]`), guarded on the outcome map rather than a
   * per-request flag, since the buyer may reload this page any number of times.
   */
  view(): UpsellViewModel | null {
    const state = this.journeyStoreFactory.get().currentState();
    if (state === null) return null;

    const upsell = this.queue.current(state);
    if (upsell === null) return null;

    if (state.upsellOutcomes[upsell.key] === undefined) {
      state.upsellOutcomes[upsell.key] = JourneyState.UPSELL_OFFERED;
      void this.events.upsellOffered(this.journeyStoreFactory.get().sessionUuid(), upsell.slug, upsell.name);
    }

    // The figure the buyer is about to be shown is the figure they may be charged, frozen here
    // rather than re-read when the answer arrives — rewritten on every render, so a refused drift
    // resolves itself on the buyer's next look.
    state.upsellQuotes[upsell.key] = upsell.priceCents;

    const [position, total] = this.queue.position(state);

    return new UpsellViewModel(
      upsell.key,
      upsell.eyebrow,
      upsell.headline,
      upsell.body,
      upsell.bullets,
      upsell.image,
      upsell.name,
      upsell.priceCents,
      this.currency(),
      upsell.acceptLabel,
      upsell.declineLabel,
      upsell.footnote,
      UpsellService.ACCEPT_PATH,
      UpsellService.DECLINE_PATH,
      position,
      total,
    );
  }

  /**
   * The buyer said yes: charge the stored instrument for this one offer and move them along,
   * whatever the provider says (`[16.8]`, `[16.11]`).
   *
   * @param answeringKey the offer key the page that posted this was showing — confirms which offer
   * is being answered, never chooses one: what is charged is always the queue's current, and a key
   * that disagrees refuses rather than being honoured.
   */
  async accept(context: RequestContext | null = null, answeringKey: string | null = null): Promise<UpsellResult> {
    const journeyStore = this.journeyStoreFactory.get();
    const state = journeyStore.currentState();
    if (state === null) {
      return new UpsellResult(this.receiptPath());
    }

    // 1. Before anything costs money — its own bucket, since this is a different action with a
    //    different honest allowance: one click, no form to get wrong.
    if (!(await this.limiter.allow('upsell.accept', this.rateLimitIdentity(context)))) {
      this.log.info('upsell.rate_limited', {});
      return new UpsellResult(this.upsellPath(), UpsellService.RATE_LIMITED_NOTICE);
    }

    // 2. Which offer this is an answer to. None means the queue emptied under a replayed POST.
    const upsell = this.queue.current(state);
    if (upsell === null) {
      return new UpsellResult(this.receiptPath());
    }

    // 2b. The answer has to be about the offer on screen — two tabs are all it takes for it not to
    //     be. A confirmation, never a selection: what is charged is still whatever the cursor points
    //     at, and a disagreeing key is refused outright.
    if (answeringKey !== null && answeringKey !== upsell.key) {
      this.log.info('upsell.stale_answer', { answering: answeringKey, current: upsell.key });
      return new UpsellResult(this.upsellPath(), UpsellService.OFFER_MOVED_NOTICE);
    }

    // 3. `[15.13]`. No handle means no charge is possible — a property of the provider, not
    //    anything the buyer did — so nothing is said to them.
    const credential = state.reusableCredential();
    if (credential === null || !credential.isReusable()) {
      this.log.info('upsell.no_credential', { key: upsell.key });
      this.answered(state, JourneyState.UPSELL_SKIPPED);
      return new UpsellResult(this.onwardPath(state));
    }

    // 3b. The price the buyer was shown, and the only one they may be charged. A stored quote that
    //     disagrees with the live price is a real drift; no stored quote is an answer to an offer
    //     nothing recorded showing — both refuse, and both recover on the next render.
    const quotedCents = state.upsellQuotes[upsell.key] ?? null;

    if (quotedCents === null) {
      this.log.info('upsell.unquoted_answer', { key: upsell.key, live_cents: upsell.priceCents });
      return new UpsellResult(this.upsellPath(), UpsellService.UNQUOTED_NOTICE);
    }

    if (quotedCents !== upsell.priceCents) {
      this.log.warning('upsell.price_moved', { key: upsell.key, quoted_cents: quotedCents, live_cents: upsell.priceCents });
      return new UpsellResult(this.upsellPath(), UpsellService.PRICE_MOVED_NOTICE);
    }

    // 4. `[13.37]`. The offer, not the cart, is the material — the cart was cleared when the first
    //    order was placed. The price is deliberately not key material (see class doc comment).
    const key = IdempotencyKey.forUpsell(journeyStore.sessionUuid(), this.sessionKey(), upsell.key, upsell.slug, upsell.variantId);

    // Read once and carried — the ownership token every later write against this row is
    // conditional on.
    const claimedAt = this.clock();

    let claimed: boolean;
    try {
      claimed = await this.attempts.claim(key, this.sessionKey(), claimedAt);
    } catch (error) {
      this.log.error('upsell.attempt_unrecordable', { key: upsell.key, reason: CardScrubber.scrub(error instanceof Error ? error.message : String(error)) });
      this.answered(state, JourneyState.UPSELL_SKIPPED);
      return new UpsellResult(this.onwardPath(state));
    }

    if (!claimed) {
      return this.duplicate(state, key, upsell);
    }

    const envelope = this.envelope(state, upsell, key, context);

    // 5. Written before the call — a request that dies mid-charge leaves whatever this row last
    //    said, and a row still saying `claimed` invites a takeover to re-post an identical payload.
    try {
      await this.attempts.markSent(key, claimedAt);
    } catch (error) {
      if (error instanceof CheckoutAttemptTakenOver) {
        this.log.warning('upsell.attempt_taken_over', { key: upsell.key, idempotency_key: key, reason: error.message });
        return this.duplicate(state, key, upsell);
      }

      this.log.error('upsell.attempt_unrecordable', { key: upsell.key, reason: CardScrubber.scrub(error instanceof Error ? error.message : String(error)) });
      await this.releaseQuietly(key, claimedAt);
      this.answered(state, JourneyState.UPSELL_SKIPPED);
      return new UpsellResult(this.onwardPath(state));
    }

    // 6. Everything below this line is past the point of no return.
    const outcome = await this.adapter.place(envelope, credential);
    await this.settleAttempt(key, claimedAt, upsell, outcome);

    // A challenge is not a decline — treating it as one loses an order the provider has already
    // created. The buyer moves on either way (`[16.11]`), but the reference is kept as a placed
    // order so the receipt and completion totals know it exists.
    if (outcome.state === PlacementOutcome.PENDING_ACTION) {
      return this.pendingAction(state, upsell, envelope, outcome, credential);
    }

    return outcome.isPlaced() ? this.placed(state, upsell, envelope, outcome, credential) : this.chargeDeclined(state, upsell, envelope, outcome, credential);
  }

  private async pendingAction(state: JourneyState, upsell: Upsell, envelope: OrderEnvelope, outcome: PlacementOutcome, credential: PaymentCredential): Promise<UpsellResult> {
    const reference = outcome.reference ?? '';

    this.log.warning('upsell.pending_action', { key: upsell.key, reference, session_uuid: this.journeyStoreFactory.get().sessionUuid(), amount_cents: envelope.totalCents });

    await this.guard.run('record_upsell_order', reference, () => this.orders.record(envelope, outcome, credential, [], this.adapter.capabilities().providerCategory, true));

    state.recordPlacedOrder(reference);
    await this.guard.run('report_upsell_pending', reference, () => this.events.upsellDeclined(this.journeyStoreFactory.get().sessionUuid(), upsell.slug, upsell.name));

    this.answered(state, JourneyState.UPSELL_CHARGE_DECLINED);

    return new UpsellResult(this.onwardPath(state), null, outcome);
  }

  /** The buyer said no: record it, report it, advance (`[16.9]`) — no provider call, no attempt row. */
  async decline(answeringKey: string | null = null): Promise<UpsellResult> {
    const journeyStore = this.journeyStoreFactory.get();
    const state = journeyStore.currentState();
    if (state === null) {
      return new UpsellResult(this.receiptPath());
    }

    const upsell = this.queue.current(state);
    if (upsell === null) {
      return new UpsellResult(this.receiptPath());
    }

    if (answeringKey !== null && answeringKey !== upsell.key) {
      this.log.info('upsell.stale_answer', { answering: answeringKey, current: upsell.key, action: 'decline' });
      return new UpsellResult(this.upsellPath(), UpsellService.OFFER_MOVED_NOTICE);
    }

    await this.events.upsellDeclined(journeyStore.sessionUuid(), upsell.slug, upsell.name);
    this.log.info('upsell.declined', { key: upsell.key });
    this.answered(state, JourneyState.UPSELL_DECLINED);

    return new UpsellResult(this.onwardPath(state));
  }

  /** The charge stood: record it locally, refresh the handle, report it, and advance — every write after the money moved runs inside `PostChargeGuard`. */
  private async placed(state: JourneyState, upsell: Upsell, envelope: OrderEnvelope, outcome: PlacementOutcome, credential: PaymentCredential): Promise<UpsellResult> {
    const reference = outcome.reference ?? '';

    await this.guard.run('record_upsell_order', reference, () => this.orders.record(envelope, outcome, credential, [], this.adapter.capabilities().providerCategory, true));
    await this.guard.run('record_upsell_placed', reference, () => state.recordPlacedOrder(reference));

    const refreshed = outcome.reusableCredential;
    if (refreshed !== null && refreshed.isReusable()) {
      await this.guard.run('refresh_credential', reference, () => state.storeReusableCredential(refreshed));
    }

    await this.guard.run('report_upsell_accepted', reference, () => this.events.upsellAccepted(this.journeyStoreFactory.get().sessionUuid(), upsell.slug, upsell.name));

    this.log.info('upsell.accepted', { key: upsell.key, reference });
    this.answered(state, JourneyState.UPSELL_ACCEPTED);

    return new UpsellResult(this.onwardPath(state), null, outcome);
  }

  /**
   * The charge did not stand, and the buyer moves on anyway (`[16.11]`) — no notice, since the order
   * they came for is unaffected. The reference is NOT added to `placedOrders`: that list is what
   * completion batches to the EMR as orders placed, and a declined reference in it would report an
   * order that does not exist.
   */
  private async chargeDeclined(state: JourneyState, upsell: Upsell, envelope: OrderEnvelope, outcome: PlacementOutcome, credential: PaymentCredential): Promise<UpsellResult> {
    if (outcome.reference !== null) {
      await this.guard.run('record_upsell_order', outcome.reference, () => this.orders.record(envelope, outcome, credential, [], this.adapter.capabilities().providerCategory, true));
    }

    await this.guard.run('report_upsell_declined', outcome.reference, () => this.events.upsellDeclined(this.journeyStoreFactory.get().sessionUuid(), upsell.slug, upsell.name));

    this.log.info('upsell.charge_declined', { key: upsell.key, reference: outcome.reference, raw_status: outcome.rawStatus });

    this.answered(state, JourneyState.UPSELL_CHARGE_DECLINED);

    return new UpsellResult(this.onwardPath(state), null, outcome);
  }

  /**
   * Somebody else holds this key. A completed attempt is replayed: its stored answer is applied to
   * the queue and the buyer moves on, without the provider being reached again. An unfinished
   * attempt is answered with the offer still on screen and the confirming notice.
   */
  private async duplicate(state: JourneyState, key: string, upsell: Upsell): Promise<UpsellResult> {
    const row = await this.attempts.outcomeFor(key);
    const attempt = row === null ? null : CheckoutAttempt.fromRow(row);
    const stored = attempt?.outcome ?? null;

    if (attempt !== null && attempt.isComplete() && stored !== null) {
      this.log.info('upsell.duplicate_replayed', { key: upsell.key, idempotency_key: key, replayed_state: stored.state });

      if (stored.isPlaced() && stored.reference !== null) {
        state.recordPlacedOrder(stored.reference);
      }

      this.answered(state, stored.isPlaced() ? JourneyState.UPSELL_ACCEPTED : JourneyState.UPSELL_CHARGE_DECLINED);

      return new UpsellResult(this.onwardPath(state), null, stored);
    }

    this.log.warning('upsell.duplicate_in_flight', {
      key: upsell.key,
      idempotency_key: key,
      session_uuid: this.journeyStoreFactory.get().sessionUuid(),
      amount_cents: upsell.priceCents,
      attempt_state: attempt?.state ?? 'absent',
    });

    return new UpsellResult(this.upsellPath(), UpsellService.CONFIRMING_NOTICE);
  }

  /** Records what the provider said against the attempt, in the one way that is safe for the outcome in hand — reuses `CheckoutAttempt.releasesKey()` rather than restating it. */
  private async settleAttempt(key: string, claimedAt: string, upsell: Upsell, outcome: PlacementOutcome): Promise<void> {
    if (CheckoutAttempt.releasesKey(outcome)) {
      await this.releaseQuietly(key, claimedAt);
      return;
    }

    if (!outcome.isPlaced() && outcome.state !== PlacementOutcome.PENDING_ACTION) {
      this.log.error('upsell.attempt_unresolved', {
        idempotency_key: key,
        session_uuid: this.journeyStoreFactory.get().sessionUuid(),
        amount_cents: upsell.priceCents,
        reference: outcome.reference,
        raw_status: outcome.rawStatus,
        reason: 'the provider never answered, so the key is kept and no outcome is stored',
      });
      return;
    }

    await this.guard.run('record_upsell_outcome', outcome.reference, () => this.attempts.recordOutcome(key, CheckoutAttempt.encodeOutcome(outcome)));
  }

  private async releaseQuietly(key: string, claimedAt: string): Promise<void> {
    try {
      await this.attempts.release(key, claimedAt);
    } catch (error) {
      this.log.error('upsell.attempt_not_released', { reason: CardScrubber.scrub(error instanceof Error ? error.message : String(error)) });
    }
  }

  /** One offer as an order the provider can be told about (`[16.8]`) — one line, no promotion, no discount (`[13.17]`). */
  private envelope(state: JourneyState, upsell: Upsell, key: string, context: RequestContext | null): OrderEnvelope {
    const line = new OrderLine(upsell.slug, upsell.name, upsell.providerOffer, upsell.providerItem, upsell.priceCents, 1, upsell.kind, upsell.emrProductId, upsell.emrVariantId);

    return new OrderEnvelope(
      [line],
      UpsellService.buyer(state.buyer),
      upsell.priceCents,
      0,
      upsell.priceCents,
      this.currency(),
      null,
      state.attribution?.params ?? {},
      this.journeyStoreFactory.get().sessionUuid(),
      context?.clientIp ?? null,
      context?.userAgent ?? null,
      key,
      upsell.slug,
      this.settlement.forSlug(upsell.slug),
      null,
      // A second order on a journey that already has one — which a provider whose order the EMR reads back has to say.
      true,
    );
  }

  /** The stored contact details as the provider contract wants them — read from journey state, since this page posts no contact fields (`[16.8]` reuses what checkout collected). */
  private static buyer(stored: Record<string, string>): Buyer {
    return new Buyer(
      stored.first_name ?? '',
      stored.last_name ?? '',
      stored.email ?? '',
      stored.phone ?? '',
      stored.address_line ?? '',
      stored.city ?? '',
      (stored.territory ?? '').toUpperCase(),
      stored.postal_code ?? '',
    );
  }

  /** Where an answered offer sends the buyer: the next offer, or the receipt (`[16.5]`). */
  private onwardPath(state: JourneyState): string {
    return this.queue.isSpent(state) ? this.receiptPath() : this.upsellPath();
  }

  /**
   * The offer on screen has been answered: record the outcome and note that this journey got as far
   * as the upsell step (`[21.7]`). Every one of the ways an offer can be answered goes through here
   * — deliberately not called from `view()`, since a render that advanced the step would describe a
   * buyer who walked away from the offer as having answered it.
   */
  private answered(state: JourneyState, outcome: string): void {
    this.queue.advance(state, outcome);
    FurthestStep.advance(state, UpsellService.UPSELL_STEP);
  }

  private upsellPath(): string {
    return this.flow.allSteps()[UpsellService.UPSELL_STEP] !== undefined ? this.flow.pathFor(UpsellService.UPSELL_STEP) : this.receiptPath();
  }

  private receiptPath(): string {
    return this.flow.allSteps()['receipt'] !== undefined ? this.flow.pathFor('receipt') : this.flow.pathFor(FlowDefinition.ENTRY_STEP);
  }

  private rateLimitIdentity(context: RequestContext | null): string {
    return context?.clientIp ?? `session:${this.sessionKey()}`;
  }

  private sessionKey(): string {
    return this.request.sessionID ?? '';
  }

  private currency(): string {
    return String(this.config.get('payment.currency', 'USD'));
  }
}
