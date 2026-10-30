import { PaymentCredential } from '../payment/payment-credential';
import { Attribution, AttributionData } from './attribution';

export type VerificationStatus = 'passed' | 'failed' | 'inconclusive';

export interface VerificationRecord {
  status: VerificationStatus;
  at: string;
  basis: string | null;
  check: string | null;
}

export interface CartLineData {
  slug: string;
  name: string;
  kind: string;
  emr_product_id: string | null;
  parent_slug: string | null;
  quantity: number;
  unit_price_cents: number;
  variant_id: string | null;
}

export interface CartData {
  lines: CartLineData[];
  territory: string | null;
}

/**
 * Reduced port of storefront-lamp/core/Journey/JourneyState.php — the durable state attached to
 * one analytics session, persisted as `sessions.journey_state`.
 *
 * The PHP original carries every field the whole application accumulates across a journey (~20
 * public properties in one 46KB file). This port grows the same way, one field per phase, added
 * by whichever phase's subsystem needs it. Phase 2 added `opportunityId`/`attribution`/
 * `reconciled`/`readModelShape`/`sessionRetired`. Phase 4 adds what `Cart`/`FunnelRouter`/
 * `StepPreconditions`/`FurthestStep` need to gate and route the funnel: `cart` (the serialized
 * `Cart`, mirroring `CartStore`'s dual-write), `furthestStep`, `formStatus`/`formCompleted()`
 * (Phase 6 builds the intake engine that actually calls `markFormCompleted()` — the field and its
 * read-side logic are correct now, just never set to anything but empty until then),
 * `disqualifiedRule`/`disqualifiedTeleform`/`isDisqualified()` (same: nothing produces a
 * disqualification until Phase 6's rule engine exists), `verification`/`verificationPassed()`
 * (Phase 6's identity check — inert today since `verification.enabled` ships `false`), and
 * `placedOrders` (Phase 7 is the first thing that ever calls `recordPlacedOrder()`). Phase 5 adds
 * `cartMirrored` — the durable flag `CartMirror` uses to decide create-vs-update against the EMR
 * cart resource; inert under the Null `CART_GATEWAY` this whole effort ships with, but the flag
 * and its semantics are real. Phase 6 adds `answers` (per-teleform stored answers, keyed by
 * teleform id — `IntakeSession` reads/writes this on every save) and `emrEvents` (which EMR
 * lifecycle events have already been sent, so a returning visitor re-opening a form doesn't
 * re-fire its `*_initiated` event and produce a second lead).
 */
export interface JourneyStateData {
  opportunityId: string | null;
  attribution: AttributionData | null;
  reconciled: boolean;
  readModelShape: number | null;
  sessionRetired: boolean;
  cart: CartData;
  cartMirrored: boolean;
  furthestStep: string | null;
  formStatus: Record<string, string>;
  disqualifiedRule: string | null;
  disqualifiedTeleform: string | null;
  verification: VerificationRecord | null;
  placedOrders: string[];
  /** `PaymentDescriptor.toArray()` of the checkout payment — what the receipt-time treatments sync reports. */
  paymentSummary: Record<string, unknown> | null;
  answers: Record<string, Record<string, unknown>>;
  emrEvents: string[];
  /**
   * The buyer details typed at checkout (`first_name`, `last_name`, `email`, `phone`,
   * `address_line`, `city`, `territory`, `postal_code`) — `Prefill`'s "working state" argument.
   * `VerificationStep` (Phase 6) reads it, since prefill precedence is stored intake answers
   * first, this second (`[13.5c]`); Phase 7's `CheckoutService.submit()` step 4 is the first thing
   * to actually write it, before the payment provider is ever called (`[13.30]`).
   */
  buyer: Record<string, string>;

  /** Phase 7: the discount code applied against this cart, and the digest it was quoted against — see `CheckoutService.repricePromotion()`. */
  promotion: { code: string; discount_cents: number; reference?: string } | null;
  promotionQuotedAgainst: string | null;
  /**
   * The checkout payment the provider is waiting on the buyer to verify (`[14.22]`), or null when
   * nothing is pending. Durable because the challenge spans requests. Identifiers only: the
   * provider's reference, and the idempotency key with the claim time that owns its
   * `checkout_attempts` row. The client action that runs the challenge is a secret and is never
   * stored. The reference comes from here and never from a request.
   */
  pendingPayment: PendingPayment | null;
  /** Phase 7: order-bump product slugs the buyer has accepted on the checkout page (`[27.1]`). */
  acceptedBumps: string[];
  /** Phase 7: what the buyer agreed to at checkout, one record per configured consent (`[26.6]`). */
  consents: Array<{ key: string; granted: boolean; copy_version: string; copy_shown: string; at: string }>;
  /**
   * Phase 7: the opaque, provider-issued handle a placed order's adapter may return in place of the
   * raw card — never the card itself (`[15.12]`, `[15.13]`). Null when the adapter declared none, or
   * after a decline wipes it (`[15.8]`). Stored in `PaymentCredential.toStorable()`'s shape; read
   * back through the `reusableCredential()` method, which reconstructs the real object.
   */
  reusableCredentialData: { kind: string; handle: Record<string, string> } | null;
  /** Phase 7 writes these at checkout success (`[16.1]`); Phase 8's upsell flow steps them. */
  upsellQueue: string[];
  upsellCursor: number;
  /** Phase 8: outcome per upsell key — one of the `JourneyState.UPSELL_*` constants. */
  upsellOutcomes: Record<string, string>;
  /** Phase 8: the price quoted at render time for each upsell key, so `UpsellService.accept()` can detect drift (`[16.8]`). */
  upsellQuotes: Record<string, number>;
  /** Phase 8: the frozen receipt snapshot, written once by `Completion.complete()` and read on every later `/thank-you/` visit. */
  receipt: Record<string, unknown> | null;
  /** Phase 8: when `Completion.complete()` ran — `isComplete()`'s backing field, `[17.1]`'s fire-once guard. */
  completedAt: string | null;
}

export interface PendingPayment {
  reference: string;
  idempotency_key: string;
  claimed_at: string;
}

export const FORM_IN_PROGRESS = 'in_progress';
const FORM_COMPLETED = 'completed';

export class JourneyState {
  /** Fired once, guarded on `upsellOutcomes` rather than a per-request flag (`[16.7]`). */
  static readonly UPSELL_OFFERED = 'offered';
  /** An entry the configuration could no longer resolve, or one the buyer had no reusable credential to charge. */
  static readonly UPSELL_SKIPPED = 'skipped';
  static readonly UPSELL_DECLINED = 'declined';
  static readonly UPSELL_ACCEPTED = 'accepted';
  /** The provider was reached and refused the charge — the order the buyer came for is unaffected. */
  static readonly UPSELL_CHARGE_DECLINED = 'charge_declined';

  opportunityId: string | null = null;
  attribution: Attribution | null = null;
  reconciled = false;
  readModelShape: number | null = null;
  sessionRetired = false;
  cart: CartData = { lines: [], territory: null };
  cartMirrored = false;
  furthestStep: string | null = null;
  formStatus: Record<string, string> = {};
  disqualifiedRule: string | null = null;
  disqualifiedTeleform: string | null = null;
  verification: VerificationRecord | null = null;
  placedOrders: string[] = [];
  paymentSummary: Record<string, unknown> | null = null;
  answers: Record<string, Record<string, unknown>> = {};
  emrEvents: string[] = [];
  buyer: Record<string, string> = {};
  promotion: { code: string; discount_cents: number; reference?: string } | null = null;
  promotionQuotedAgainst: string | null = null;
  acceptedBumps: string[] = [];
  consents: Array<{ key: string; granted: boolean; copy_version: string; copy_shown: string; at: string }> = [];
  pendingPayment: PendingPayment | null = null;
  reusableCredentialData: { kind: string; handle: Record<string, string> } | null = null;
  upsellQueue: string[] = [];
  upsellCursor = 0;
  upsellOutcomes: Record<string, string> = {};
  upsellQuotes: Record<string, number> = {};
  receipt: Record<string, unknown> | null = null;
  completedAt: string | null = null;

  static fromArray(
    journeyState: Partial<JourneyStateData>,
    attribution: AttributionData | null,
    opportunityId: string | null,
  ): JourneyState {
    const state = new JourneyState();
    state.opportunityId = journeyState.opportunityId ?? opportunityId ?? null;
    state.attribution = attribution ? Attribution.fromArray(attribution) : null;
    state.reconciled = journeyState.reconciled ?? false;
    state.readModelShape = journeyState.readModelShape ?? null;
    state.sessionRetired = journeyState.sessionRetired ?? false;
    state.cart = journeyState.cart ?? { lines: [], territory: null };
    state.cartMirrored = journeyState.cartMirrored ?? false;
    state.furthestStep = journeyState.furthestStep ?? null;
    state.formStatus = journeyState.formStatus ?? {};
    state.disqualifiedRule = journeyState.disqualifiedRule ?? null;
    state.disqualifiedTeleform = journeyState.disqualifiedTeleform ?? null;
    state.verification = journeyState.verification ?? null;
    state.placedOrders = journeyState.placedOrders ?? [];
    state.paymentSummary = journeyState.paymentSummary ?? null;
    state.answers = journeyState.answers ?? {};
    state.emrEvents = journeyState.emrEvents ?? [];
    state.buyer = journeyState.buyer ?? {};
    state.promotion = journeyState.promotion ?? null;
    state.promotionQuotedAgainst = journeyState.promotionQuotedAgainst ?? null;
    state.acceptedBumps = journeyState.acceptedBumps ?? [];
    state.consents = journeyState.consents ?? [];
    state.pendingPayment = JourneyState.readPendingPayment(journeyState.pendingPayment);
    state.reusableCredentialData = journeyState.reusableCredentialData ?? null;
    state.upsellQueue = journeyState.upsellQueue ?? [];
    // Clamped to zero on the way out of the database — see `UpsellQueue.current()`'s doc comment
    // for why a negative cursor is answered differently in-process than it is here.
    state.upsellCursor = Math.max(0, journeyState.upsellCursor ?? 0);
    state.upsellOutcomes = journeyState.upsellOutcomes ?? {};
    state.upsellQuotes = journeyState.upsellQuotes ?? {};
    state.receipt = journeyState.receipt ?? null;
    state.completedAt = journeyState.completedAt ?? null;
    return state;
  }

  toArray(): JourneyStateData {
    return {
      opportunityId: this.opportunityId,
      attribution: this.attribution?.toArray() ?? null,
      reconciled: this.reconciled,
      readModelShape: this.readModelShape,
      sessionRetired: this.sessionRetired,
      cart: this.cart,
      cartMirrored: this.cartMirrored,
      furthestStep: this.furthestStep,
      formStatus: this.formStatus,
      disqualifiedRule: this.disqualifiedRule,
      disqualifiedTeleform: this.disqualifiedTeleform,
      verification: this.verification,
      placedOrders: this.placedOrders,
      paymentSummary: this.paymentSummary,
      answers: this.answers,
      emrEvents: this.emrEvents,
      buyer: this.buyer,
      promotion: this.promotion,
      promotionQuotedAgainst: this.promotionQuotedAgainst,
      acceptedBumps: this.acceptedBumps,
      consents: this.consents,
      pendingPayment: JourneyState.readPendingPayment(this.pendingPayment),
      reusableCredentialData: this.reusableCredentialData,
      upsellQueue: this.upsellQueue,
      upsellCursor: this.upsellCursor,
      upsellOutcomes: this.upsellOutcomes,
      upsellQuotes: this.upsellQuotes,
      receipt: this.receipt,
      completedAt: this.completedAt,
    };
  }

  /** All three identifiers or nothing: a reference without its attempt row could be finished but never released. */
  private static readPendingPayment(raw: unknown): PendingPayment | null {
    if (raw === null || typeof raw !== 'object') return null;
    const row = raw as Record<string, unknown>;
    const { reference, idempotency_key: key, claimed_at: claimedAt } = row;
    if (typeof reference !== 'string' || reference === '' || typeof key !== 'string' || key === '' || typeof claimedAt !== 'string' || claimedAt === '') return null;

    return { reference, idempotency_key: key, claimed_at: claimedAt };
  }

  fingerprint(): string {
    return JSON.stringify([this.toArray(), this.opportunityId, this.attribution?.toArray() ?? null]);
  }

  /** Records that a teleform has been submitted, which is what lets the next funnel step open. */
  markFormCompleted(teleformId: string): void {
    this.formStatus[teleformId] = FORM_COMPLETED;
  }

  /** The answers stored so far for one teleform, or empty when none have been given yet. */
  answersFor(teleformId: string): Record<string, unknown> {
    return this.answers[teleformId] ?? {};
  }

  storeAnswers(teleformId: string, data: Record<string, unknown>): void {
    this.answers[teleformId] = data;
  }

  /** Whether this journey has already sent `eventValue` to the EMR — guards against a returning visitor re-firing a `*_initiated` event. */
  hasEmrEvent(eventValue: string): boolean {
    return this.emrEvents.includes(eventValue);
  }

  recordEmrEvent(eventValue: string): void {
    if (!this.emrEvents.includes(eventValue)) {
      this.emrEvents.push(eventValue);
    }
  }

  startForm(teleformId: string): void {
    this.formStatus[teleformId] ??= FORM_IN_PROGRESS;
  }

  formCompleted(teleformId: string): boolean {
    return this.formStatus[teleformId] === FORM_COMPLETED;
  }

  isDisqualified(): boolean {
    return this.disqualifiedRule !== null;
  }

  /** Records the server's verdict that this journey is not eligible (`[10.42]`). */
  recordDisqualification(teleformId: string, ruleId: string): void {
    this.disqualifiedRule = ruleId;
    this.disqualifiedTeleform = teleformId;
  }

  /** Lifts a disqualification — needed so "start over" doesn't hand back a permanently blocked funnel. */
  clearDisqualification(): void {
    this.disqualifiedRule = null;
    this.disqualifiedTeleform = null;
  }

  recordVerification(status: VerificationStatus, basis: string | null = null, check: string | null = null): void {
    this.verification = { status, at: new Date().toISOString(), basis, check };
  }

  /** Deliberately not "did not fail": an inconclusive or never-asked verdict both answer false. */
  verificationPassed(): boolean {
    return this.verification?.status === 'passed';
  }

  /** Deduplicated: a retried report of the same placement must not look like a second order. */
  recordPlacedOrder(reference: string): void {
    if (!this.placedOrders.includes(reference)) {
      this.placedOrders.push(reference);
    }
  }

  /** `[13.30]`: written before the provider is called, so a decline or a mid-charge crash still re-fills the form. */
  storeBuyer(details: Record<string, string>): void {
    this.buyer = details;
  }

  /**
   * `[15.12]`, `[15.13]`: stores the opaque handle a placed order's adapter returned in place of
   * the card, or clears it when the adapter declared none reusable. Never the card itself — see
   * `PaymentCredential.toStorable()`, which throws for a raw card credential.
   */
  storeReusableCredential(credential: { toStorable(): { kind: string; handle: Record<string, string> } } | null): void {
    this.reusableCredentialData = credential === null ? null : credential.toStorable();
  }

  /** The stored handle, reconstructed — null when none was stored, or when the stored shape isn't `KIND_STORED_INSTRUMENT` (`PaymentCredential.fromStorable()` refuses anything else). */
  reusableCredential(): PaymentCredential | null {
    return this.reusableCredentialData === null ? null : PaymentCredential.fromStorable(this.reusableCredentialData);
  }

  /** `[15.8]`: a card held after a failed charge is held for nothing. */
  wipePaymentCredential(): void {
    this.reusableCredentialData = null;
  }

  /** `[17.1]`'s fire-once guard: has `Completion.complete()` already run for this journey? */
  isComplete(): boolean {
    return this.completedAt !== null;
  }

  /**
   * `[17.4]`, `[4.16]`: clears the attribution the treatment sync forwards and the buyer contact
   * the receipt's shipping block is built from — called last, by `Completion.complete()`, once
   * every action that still needs them has already run.
   */
  wipeForCompletion(): void {
    this.attribution = null;
    this.buyer = {};
    this.paymentSummary = null;
  }
}
