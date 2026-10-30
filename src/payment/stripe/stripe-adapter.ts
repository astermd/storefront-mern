import { createHash } from 'node:crypto';
import Stripe from 'stripe';
import { CouponGateway } from '../../emr/coupon-gateway';
import { CardScrubber } from '../../support/card-scrubber';
import { OperatorLog } from '../../support/operator-log';
import { AdapterCapabilities, SCOPE_ORDER_LEVEL, STRATEGY_TOKENIZATION, SURFACE_PROVIDER_HOSTED } from '../adapter-capabilities';
import { CaptureOutcome } from '../capture-outcome';
import { CaptureRequest } from '../capture-request';
import { OrderEnvelope } from '../order-envelope';
import { OrderSearch } from '../order-search';
import { OrderSearchResult } from '../order-search-result';
import { PaymentAdapter } from '../payment-adapter';
import { PaymentCredential } from '../payment-credential';
import { PlacementOutcome } from '../placement-outcome';
import { PromotionQuote } from '../promotion-quote';
import { ProviderOrder } from '../provider-order';
import { StripeApiFactory } from './stripe-api-factory';
import { StripeCredentials } from './stripe-credentials';
import { StripeOutcome } from './stripe-outcome';
import { StripePayload } from './stripe-payload';

type Row = Record<string, unknown>;

/**
 * Ported from storefront-lamp/core/Payment/Stripe/StripeAdapter.php. Stripe, through PaymentIntents
 * this storefront creates and confirms itself.
 *
 * **The card never reaches this process.** Stripe's own fields collect it on the page and mint a
 * confirmation token (`[15.1]`, `[15.4c]`); the checkout posts that token, and this confirms a
 * PaymentIntent with it. What survives to pay for an upsell is the customer and card Stripe saved
 * (`StripeOutcome`), never the card.
 *
 * **The EMR reads every payment this creates.** The storefront tells it about an order by the
 * PaymentIntent's id, and the EMR builds the treatment from the PaymentIntent itself — so the line
 * items, the metadata and the saved card are written for that reader (`StripePayload`).
 *
 * **One customer per email**, found before it is created: Stripe's email filter on the customer
 * list is exact and immediately consistent, and the EMR's own checkout uses the same rule, so a
 * buyer who pays through either lands on the same customer and the same saved cards.
 *
 * **Idempotent at Stripe as well as here.** The storefront's key stops a duplicate submit before it
 * is sent (`[13.37]`); Stripe's stops a retried request from creating a second payment. The Stripe
 * key is the storefront's key and the token together, so a retry of one attempt replays its answer
 * and a second attempt with another card is a new payment.
 *
 * **Discount codes are the EMR's** (`CouponGateway`): a PaymentIntent has no notion of one, so the
 * EMR prices the code and the order names the coupon by its id. The code is priced once more just
 * before the payment is created (`repriceCoupon()`), because nothing after this point re-checks it.
 *
 * **Capture is the EMR's too.** A held payment is captured when a doctor completes the case the EMR
 * opened for it, cancelled if the case is rejected, and replaced if the hold expires first — so this
 * adapter holds funds when asked (`StripePayload.settlementFor()`) and refuses to capture them
 * itself (`capture()`).
 */
export class StripeAdapter implements PaymentAdapter {
  /** The EMR settles a held payment; capturing it here would charge before the doctor decides. */
  private static readonly SETTLED_BY_EMR = 'settled_by_emr';

  /** How many PaymentIntents one page of an order search asks for: Stripe's maximum. */
  private static readonly SEARCH_PAGE_SIZE = 100;

  /** The discount code changed between being applied and being paid for. */
  private static readonly PROMOTION_CHANGED = 'Your discount code no longer applies as it did, so it has been removed. Please review your total and try again.';

  /**
   * Stripe.js. Stripe requires it be loaded from its own domain, never bundled or self-hosted. The
   * release in the path is the one in `StripeApiFactory.API_VERSION`, so the page's Elements speak
   * the same API version as the PaymentIntent the server confirms their token with.
   */
  private static readonly STRIPE_JS = 'https://js.stripe.com/endive/stripe.js';

  constructor(
    private readonly credentials: StripeCredentials,
    private readonly apiFactory: StripeApiFactory,
    private readonly log: OperatorLog,
    private readonly coupons: CouponGateway,
    private readonly channelId: string,
    private readonly returnUrl: string,
  ) {}

  capabilities(): AdapterCapabilities {
    return new AdapterCapabilities(
      'stripe',
      this.coupons.available(),
      SCOPE_ORDER_LEVEL,
      STRATEGY_TOKENIZATION,
      SURFACE_PROVIDER_HOSTED,
      ['api_key', 'publishable_key'],
      [],
      'Tokenized: the card is entered only in Stripe-hosted fields on the checkout page and reaches this storefront as a one-time token, never as card data. Later charges on the same journey name the customer and card Stripe saved. The checkout page hosts those fields, so the page itself stays in scope; nothing on the server handles a card.',
      false,
      false,
      true,
      true,
      [],
      // What the page needs to mount Stripe's fields: the publishable key, and Stripe's own script,
      // which must be loaded from Stripe.
      { publishable_key: this.credentials.publishableKey, script: StripeAdapter.STRIPE_JS },
      true,
    );
  }

  async place(order: OrderEnvelope, credential: PaymentCredential): Promise<PlacementOutcome> {
    if (order.chargeableLines().length === 0) {
      this.log.error('payment.no_chargeable_lines', { anchor: order.anchorSlug });
      return PlacementOutcome.declined(null, StripeOutcome.GENERIC_DECLINE, 'no_chargeable_lines');
    }

    const payment = StripePayload.paymentFor(credential);
    if (Object.keys(payment).length === 0) {
      this.log.error('payment.credential_unusable', { kind: credential.kind, anchor: order.anchorSlug });
      return PlacementOutcome.declined(null, StripeOutcome.GENERIC_DECLINE, 'credential_unusable');
    }

    // Refused before anything is sent: an order the EMR cannot map back to its own products is a
    // payment with no treatment behind it.
    const lineItems = StripePayload.lineItemsMetadata(order);
    if (lineItems === null) {
      this.log.error('payment.line_unmapped', { anchor: order.anchorSlug });
      return PlacementOutcome.declined(null, StripeOutcome.GENERIC_DECLINE, 'line_unmapped');
    }

    if (lineItems.length > StripePayload.METADATA_VALUE_MAX_LENGTH) {
      this.log.error('payment.too_many_lines', { anchor: order.anchorSlug, lines: order.lines.length });
      return PlacementOutcome.declined(null, StripeOutcome.GENERIC_DECLINE, 'too_many_lines');
    }

    const settlement = StripePayload.settlementFor(order);
    if (settlement !== order.settlement) {
      this.log.info('payment.settlement_charged_instead', {
        anchor: order.anchorSlug,
        reason: order.followOn ? 'follow_on_order' : 'no_prescription_line',
      });
    }

    const dropped = StripePayload.droppedAttribution(order.attribution);
    if (dropped.length > 0) {
      this.log.info('payment.attribution_dropped', { keys: dropped });
    }

    const repriced = await this.repriceCoupon(order);
    if (repriced !== null) return repriced;

    const idempotencyKey = StripeAdapter.idempotencyKey(order, credential);

    let paymentIntent: Row;
    try {
      const stripe = this.apiFactory.create(this.credentials);
      let customerId = String(payment.customer ?? '');
      if (customerId === '') {
        customerId = await this.customerFor(stripe, order, idempotencyKey);
      }

      const body = StripePayload.forOrder(order, payment, customerId, lineItems, settlement, this.channelId, this.returnUrl);
      paymentIntent = (await stripe.paymentIntents.create(body as unknown as Stripe.PaymentIntentCreateParams, {
        idempotencyKey: `${idempotencyKey}:payment_intent`,
      })) as unknown as Row;
    } catch (e) {
      if (e instanceof Stripe.errors.StripeCardError) {
        // A refused card: Stripe created the PaymentIntent and failed it, so the reference is
        // recorded against the decline (`[13.26]`).
        const outcome = StripeOutcome.fromCardError(StripeOutcome.idOf(e.payment_intent), e.message, e.decline_code || e.code || null);
        this.log.warning('payment.not_placed', { state: outcome.state, reference: outcome.reference, raw_status: outcome.rawStatus });

        return outcome;
      }

      return this.unanswered(e);
    }

    const outcome = StripeOutcome.from(paymentIntent, order.totalCents);

    if (!outcome.isPlaced()) {
      this.log.warning('payment.not_placed', { state: outcome.state, reference: outcome.reference, raw_status: outcome.rawStatus });
    }

    const discrepancy = outcome.chargeDiscrepancy;
    if (discrepancy !== null) {
      this.log.error('payment.total_mismatch', {
        reference: outcome.reference,
        expected_cents: discrepancy.expectedCents,
        charged_cents: discrepancy.chargedCents,
        difference_cents: discrepancy.differenceCents(),
        anchor: order.anchorSlug,
      });
    }

    return outcome;
  }

  /**
   * Reads the PaymentIntent a verification left pending (`[14.22]`).
   *
   * Stripe finishes the payment itself once the buyer verifies — the PaymentIntent moves on without
   * another confirming call — so this only has to read what it moved to.
   */
  async resume(reference: string): Promise<PlacementOutcome> {
    if (!reference.startsWith('pi_')) {
      return PlacementOutcome.declined(reference, StripeOutcome.GENERIC_DECLINE, 'invalid_reference');
    }

    let paymentIntent: Row;
    try {
      paymentIntent = (await this.apiFactory.create(this.credentials).paymentIntents.retrieve(reference, { expand: ['payment_method'] })) as unknown as Row;
    } catch (e) {
      // Unanswered is not "declined": the buyer may have just verified a payment that went
      // through. Still pending, with nothing to run, is the honest answer — the confirm step asks
      // again.
      this.log.warning('payment.resume_unanswered', { reference, exception: StripeAdapter.nameOf(e) });

      return PlacementOutcome.pendingAction(reference, '', 'resume_unanswered');
    }

    return StripeOutcome.from(paymentIntent);
  }

  async quotePromotion(order: OrderEnvelope, code: string): Promise<PromotionQuote> {
    return this.coupons.quote(code, order.lines);
  }

  /**
   * The PaymentIntents this channel created inside the window, for the reverse sweep (`[21.9a]`).
   *
   * Stripe's list is newest first. A PaymentIntent another storefront or the EMR's own renewals
   * created on the same account is not this channel's to account for, so it is left out by the
   * channel id every payment from here carries.
   */
  async searchOrders(search: OrderSearch): Promise<OrderSearchResult> {
    const orders: ProviderOrder[] = [];
    let truncated = false;

    try {
      const page = this.apiFactory.create(this.credentials).paymentIntents.list({
        created: { gte: Math.floor(search.from.getTime() / 1000), lte: Math.floor(search.to.getTime() / 1000) },
        limit: Math.min(StripeAdapter.SEARCH_PAGE_SIZE, search.limit),
      });

      for await (const paymentIntent of page) {
        const row = paymentIntent as unknown as Row;
        const metadata = (row.metadata ?? {}) as Row;
        if (metadata.storefront_channel_id !== this.channelId) continue;

        if (orders.length >= search.limit) {
          truncated = true;
          break;
        }

        orders.push(StripeAdapter.orderFrom(row));
      }
    } catch (e) {
      if (e instanceof Stripe.errors.StripeConnectionError) {
        this.log.warning('payment.order_search_unreachable', {});
        return OrderSearchResult.failed('transport_error');
      }

      this.log.warning('payment.order_search_threw', { exception: StripeAdapter.nameOf(e), status: e instanceof Stripe.errors.StripeError ? (e.statusCode ?? null) : null });
      return OrderSearchResult.failed('exception');
    }

    // Stripe reports no total; one more than was returned is the honest way to say there were more
    // than the limit let through.
    return OrderSearchResult.of(orders, truncated ? orders.length + 1 : null);
  }

  /**
   * Refused: the EMR captures Stripe holds, when the doctor completes the case it opened for the
   * order.
   *
   * Capturing here would take the money before that decision, and the EMR would then read the
   * payment as settled and never ask. A failure rather than `CaptureOutcome.unsupported()`, because
   * this adapter does hold funds — the question is who releases them, and the answer is not this
   * command.
   */
  async capture(request: CaptureRequest): Promise<CaptureOutcome> {
    this.log.warning('payment.capture_refused', {
      reference: request.reference,
      reason: 'Stripe holds are captured by the EMR when the doctor completes the case',
    });

    return CaptureOutcome.failed(request.reference, StripeAdapter.SETTLED_BY_EMR);
  }

  async ping(): Promise<{ ok: boolean; detail: string }> {
    try {
      // A read every key this adapter can work with is allowed, restricted keys included — the same
      // permission placing an order needs.
      await this.apiFactory.create(this.credentials).paymentIntents.list({ limit: 1 });
    } catch (e) {
      return { ok: false, detail: `Stripe refused or was unreachable (${StripeAdapter.nameOf(e)}).` };
    }

    const mode = this.credentials.publishableKey.startsWith('pk_live_') ? 'live' : 'test';

    return { ok: true, detail: `Stripe answered (${mode} mode).` };
  }

  /**
   * The buyer's Stripe customer: the newest one with this email, or a new one.
   *
   * Created with the same idempotency key family as the payment, so a retry of the same attempt
   * cannot leave two customers behind.
   */
  private async customerFor(stripe: Stripe, order: OrderEnvelope, idempotencyKey: string): Promise<string> {
    const email = order.buyer.email;

    if (email !== '') {
      const existing = await stripe.customers.list({ email, limit: 1 });
      const found = existing.data[0];
      if (found !== undefined && typeof found.id === 'string') {
        return found.id;
      }
    }

    const created = await stripe.customers.create(StripePayload.forCustomer(order.buyer) as unknown as Stripe.CustomerCreateParams, {
      idempotencyKey: `${idempotencyKey}:customer`,
    });

    return created.id;
  }

  /**
   * Asks the EMR about the order's discount code once more, just before the payment is created, and
   * refuses the payment when the answer changed.
   *
   * Stripe takes whatever amount it is given, and the EMR records the coupon at sync without
   * refusing it, so this is the last place a code that ran out or was switched off since the buyer
   * applied it can be caught. A code the EMR now refuses, or prices differently, is a total the
   * buyer has not seen: nothing is sent to Stripe, and the checkout drops the stored code
   * (`promotion_repriced`, the raw status its own re-price uses) so the buyer sees the real total.
   * An EMR that cannot be asked right now is not a refusal — the code was priced when it was
   * applied, and a buyer is not turned away because the coupon service is slow.
   */
  private async repriceCoupon(order: OrderEnvelope): Promise<PlacementOutcome | null> {
    const code = order.promotionCode;
    if (code === null || code === '') return null;

    const quote = await this.coupons.quote(code, order.lines);

    if (!quote.accepted && quote.reason === 'unavailable') {
      this.log.warning('payment.promotion_unconfirmed', { code, anchor: order.anchorSlug });
      return null;
    }

    if (quote.accepted && quote.discountCents === order.discountCents) return null;

    this.log.info('payment.promotion_repriced', {
      code,
      valid: quote.accepted,
      reason: quote.reason,
      was_discount_cents: order.discountCents,
      now_discount_cents: quote.discountCents,
    });

    return PlacementOutcome.declined(null, quote.notice ?? StripeAdapter.PROMOTION_CHANGED, 'promotion_repriced');
  }

  /**
   * Stripe answered with an error rather than a payment, or did not answer.
   *
   * Which of the two decides whether a charge can be ruled out. A request Stripe refused as
   * malformed, unauthorised or rate-limited created nothing, so it is a decline and the key goes
   * back. One that never came back, or came back as a server error, may have created a payment: the
   * raw status says so, the attempt stays `sent`, and the buyer is told the payment is being
   * confirmed rather than that it failed.
   */
  private unanswered(e: unknown): PlacementOutcome {
    const status = e instanceof Stripe.errors.StripeError ? (e.statusCode ?? null) : null;

    this.log.error('payment.place_threw', {
      exception: StripeAdapter.nameOf(e),
      status,
      reason: CardScrubber.scrub(e instanceof Error ? e.message : String(e)),
    });

    if (e instanceof Stripe.errors.StripeConnectionError) {
      return PlacementOutcome.declined(null, StripeOutcome.GENERIC_DECLINE, 'transport_error');
    }

    if (e instanceof Stripe.errors.StripeError && (e.statusCode ?? 500) < 500) {
      return PlacementOutcome.declined(null, StripeOutcome.GENERIC_DECLINE, 'api_error');
    }

    return PlacementOutcome.declined(null, StripeOutcome.GENERIC_DECLINE, 'exception');
  }

  /**
   * The Stripe idempotency key: this order's storefront key and the instrument paying for it,
   * hashed so it stays inside Stripe's length limit and carries nothing readable.
   */
  private static idempotencyKey(order: OrderEnvelope, credential: PaymentCredential): string {
    const instrument = credential.kind === PaymentCredential.KIND_TOKEN ? (credential.reference ?? '') : (credential.handle?.payment_method ?? '');

    return `astermd-storefront:${createHash('sha256').update(`${order.idempotencyKey}|${instrument}`).digest('hex')}`;
  }

  private static orderFrom(row: Row): ProviderOrder {
    const status = typeof row.status === 'string' ? row.status : null;
    const created = row.created;
    const discount = ((row.amount_details ?? {}) as Row).discount_amount;

    return new ProviderOrder(
      String(row.id ?? ''),
      typeof created === 'number' && Number.isInteger(created) ? new Date(created * 1000).toISOString() : null,
      row.livemode !== true,
      status !== null && ['succeeded', 'requires_capture', 'processing'].includes(status),
      status,
      typeof discount === 'number' && Number.isInteger(discount) ? discount : 0,
    );
  }

  private static nameOf(e: unknown): string {
    return e instanceof Error ? e.constructor.name : 'unknown';
  }
}
