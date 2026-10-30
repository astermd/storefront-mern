import { CardScrubber } from '../../support/card-scrubber';
import { OperatorLog } from '../../support/operator-log';
import { AdapterCapabilities, SCOPE_ORDER_LEVEL, STRATEGY_ORDER_REFERENCE, SURFACE_THEME_FIELDS } from '../adapter-capabilities';
import { CaptureOutcome } from '../capture-outcome';
import { CaptureRequest } from '../capture-request';
import { OrderEnvelope } from '../order-envelope';
import { OrderSearch } from '../order-search';
import { OrderSearchResult } from '../order-search-result';
import { PaymentAdapter } from '../payment-adapter';
import { PaymentCredential } from '../payment-credential';
import { PlacementOutcome } from '../placement-outcome';
import { PromotionQuote } from '../promotion-quote';
import { SettlementMode } from '../settlement-mode';
import { CheckoutChampApiFactory } from './checkout-champ-api-factory';
import { CheckoutChampAuthorizeMode, CheckoutChampAuthorizeModeValue } from './checkout-champ-authorize-mode';
import { CheckoutChampCredentials } from './checkout-champ-credentials';
import { CheckoutChampOutcome } from './checkout-champ-outcome';
import { CheckoutChampPayload } from './checkout-champ-payload';

type Envelope = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Ported from storefront-lamp/core/Payment/CheckoutChamp/CheckoutChampAdapter.php. Real
 * CheckoutChamp integration, wrapping `@astermd-hq/checkoutchamp-client` (the npm sibling of the
 * PHP original's `astermd/checkoutchamp-client` Composer package — both explicitly unofficial,
 * same publisher as `@astermd-hq/sdk`).
 */
export class CheckoutChampAdapter implements PaymentAdapter {
  constructor(
    private readonly credentials: CheckoutChampCredentials,
    private readonly apiFactory: CheckoutChampApiFactory,
    private readonly log: OperatorLog,
    private readonly salesUrl: string = '',
    private readonly authorizeMode: CheckoutChampAuthorizeModeValue = CheckoutChampAuthorizeMode.Qa,
  ) {}

  capabilities(): AdapterCapabilities {
    return new AdapterCapabilities(
      'checkout_champ',
      true,
      SCOPE_ORDER_LEVEL,
      STRATEGY_ORDER_REFERENCE,
      SURFACE_THEME_FIELDS,
      ['api_endpoint', 'api_username', 'api_password'],
      ['offer_id', 'product_id'],
      "Reduced scope via stored-customer reuse: the card is collected by the storefront once, at checkout, and is never held afterwards — later charges name the customer the provider already holds. NOTE that this provider authenticates and takes every parameter in the QUERY STRING, including the card number and security code, so anything on the egress path that records request URLs (a forward proxy, an egress gateway, an APM agent, a TLS-inspecting appliance) records cardholder data and this deployment's provider password in clear text. Audit that path before going live; it is a larger obligation than the collection surface itself.",
      false,
      false,
      false,
      true,
      [],
      {},
      false,
    );
  }

  async place(order: OrderEnvelope, credential: PaymentCredential): Promise<PlacementOutcome> {
    if (order.chargeableLines().length === 0) {
      this.log.error('payment.no_chargeable_lines', { anchor: order.anchorSlug });
      return PlacementOutcome.declined(null, CheckoutChampOutcome.GENERIC_DECLINE, 'no_chargeable_lines');
    }

    for (const line of order.unmappedLines()) {
      this.log.info('payment.line_not_sent', { slug: line.slug, free: line.isFree() });
    }

    const paymentFields = CheckoutChampPayload.paymentFor(credential);
    if (Object.keys(paymentFields).length === 0) {
      this.log.error('payment.credential_unusable', { kind: credential.kind, anchor: order.anchorSlug });
      return PlacementOutcome.declined(null, CheckoutChampOutcome.GENERIC_DECLINE, 'credential_unusable');
    }

    const campaignId = CheckoutChampPayload.campaignFor(order);
    if (campaignId === null) {
      const offers = [...new Set(order.chargeableLines().map((line) => String(line.providerOffer)))];
      this.log.error('payment.campaign_unresolved', { anchor: order.anchorSlug, offers });
      return PlacementOutcome.declined(null, CheckoutChampOutcome.GENERIC_DECLINE, 'campaign_unresolved');
    }

    const reference = await this.openOrder(order);
    if (reference === null) {
      return PlacementOutcome.declined(null, CheckoutChampOutcome.GENERIC_DECLINE, 'lead_not_created');
    }

    const authorize = SettlementMode.isAuthorize(order.settlement);
    const holdForReview = authorize && this.authorizeMode === CheckoutChampAuthorizeMode.Qa;
    const legacyPreauth = authorize && !holdForReview;

    const body = CheckoutChampPayload.forOrder(order, credential, reference, holdForReview);

    let envelope: Envelope;
    try {
      const api = this.apiFactory.create(this.credentials);
      const { response } = await (legacyPreauth ? api.preauth(body) : api.importOrder(body)).getInObject();
      envelope = asRecord(response) ?? {};
    } catch (e) {
      this.log.error('payment.place_threw', { reason: CardScrubber.scrub(e instanceof Error ? e.message : String(e)) });
      return PlacementOutcome.declined(null, CheckoutChampOutcome.GENERIC_DECLINE, 'exception');
    }

    const outcome = CheckoutChampOutcome.from(envelope, reference, order.totalCents, order.settlement, holdForReview);

    if (!outcome.isPlaced()) {
      this.log.warning('payment.not_placed', {
        state: outcome.state,
        reference: outcome.reference,
        raw_status: outcome.rawStatus,
        response: CardScrubber.scrub(envelope),
      });
    }

    if (outcome.chargeDiscrepancy !== null) {
      this.log.error('payment.total_mismatch', {
        reference: outcome.reference,
        expected_cents: outcome.chargeDiscrepancy.expectedCents,
        charged_cents: outcome.chargeDiscrepancy.chargedCents,
        difference_cents: outcome.chargeDiscrepancy.differenceCents(),
        provider_discount_cents: outcome.chargeDiscrepancy.providerDiscountCents,
        anchor: order.anchorSlug,
      });
    }

    return outcome;
  }

  private async openOrder(order: OrderEnvelope): Promise<string | null> {
    let envelope: Envelope;
    try {
      const { response } = await this.apiFactory.create(this.credentials).importLeads(CheckoutChampPayload.forLead(order, this.salesUrl)).getInObject();
      envelope = asRecord(response) ?? {};
    } catch (e) {
      this.log.error('payment.lead_threw', { reason: CardScrubber.scrub(e instanceof Error ? e.message : String(e)) });
      return null;
    }

    const reference = CheckoutChampOutcome.referenceFrom(envelope);
    if (reference === null) {
      this.log.error('payment.lead_not_created', { anchor: order.anchorSlug, response: CardScrubber.scrub(envelope) });
    }
    return reference;
  }

  /** Not supported: this provider never answers a pending outcome, so it declares no client action and nothing asks it to resume one. */
  async resume(reference: string): Promise<PlacementOutcome> {
    return PlacementOutcome.declined(reference, CheckoutChampOutcome.GENERIC_DECLINE, 'resume_unsupported');
  }

  /**
   * Price a code against the cart: `POST /order/coupon/`.
   *
   * A zero discount is refused as `invalid`: the provider answers an unknown code exactly as it
   * answers a real code worth nothing on these lines (SUCCESS, both amounts zero), so a zero is no
   * evidence the code exists. A code it recognises and refuses (expired, say) answers ERROR with a
   * sentence, which is logged and also `invalid`. Only `priceDiscount` counts — the storefront
   * charges no shipping line, so a `shipDiscount` is logged rather than added. Failing to reach the
   * provider degrades to a rejected code rather than an error (`[13.14]`).
   */
  async quotePromotion(order: OrderEnvelope, code: string): Promise<PromotionQuote> {
    code = code.trim();
    if (code === '') return PromotionQuote.rejected(code, 'empty');

    if (order.chargeableLines().length === 0 || CheckoutChampPayload.campaignFor(order) === null) {
      return PromotionQuote.rejected(code, 'no_offers');
    }

    let response: Envelope | null;
    try {
      const result = await this.apiFactory.create(this.credentials).orderCoupon(CheckoutChampPayload.forCoupon(order, code)).getInObject();
      response = asRecord(result.response);
    } catch (e) {
      this.log.warning('payment.promotion_threw', { reason: CardScrubber.scrub(e instanceof Error ? e.message : String(e)) });
      return PromotionQuote.rejected(code, 'unavailable');
    }

    if (response === null || response.curlError !== undefined) {
      return PromotionQuote.rejected(code, 'unavailable');
    }

    const message = asRecord(response.message);
    if (response.result !== 'SUCCESS' || message === null) {
      this.log.info('payment.promotion_refused', { response: CardScrubber.scrub(response) });
      return PromotionQuote.rejected(code, 'invalid', CheckoutChampAdapter.couponNotice(response.message));
    }

    const priceDiscount = message.priceDiscount;
    const cents = CheckoutChampAdapter.isNumeric(priceDiscount) ? Math.round(Number(priceDiscount) * 100) : 0;

    const shipDiscount = message.shipDiscount;
    if (CheckoutChampAdapter.isNumeric(shipDiscount) && Number(shipDiscount) > 0) {
      this.log.info('payment.promotion_ship_discount_ignored', { ship_discount: String(shipDiscount) });
    }

    if (cents <= 0) return PromotionQuote.rejected(code, 'invalid');

    return PromotionQuote.accepted(code, cents);
  }

  /**
   * The refusal's own text, when it is about the code and so worth showing the buyer ("This coupon
   * has already been redeemed", "Coupon is expired"). The same ERROR result also carries faults in
   * the request itself ("No products exist in the order", a refused login), which say nothing a
   * buyer can act on, so only a message that names the coupon is passed on.
   */
  private static couponNotice(message: unknown): string | null {
    if (typeof message !== 'string') return null;

    const text = message.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

    if (text === '' || text.length > 200 || !text.toLowerCase().includes('coupon')) return null;

    return text;
  }

  private static isNumeric(value: unknown): boolean {
    return (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)));
  }

  /** Deliberately unsupported, even though `orderQuery` exists — an unverified projection would produce false confidence in the reverse-reconciliation sweep. */
  async searchOrders(_search: OrderSearch): Promise<OrderSearchResult> {
    return OrderSearchResult.unsupported();
  }

  async capture(request: CaptureRequest): Promise<CaptureOutcome> {
    const reference = request.reference.trim();
    if (reference === '') {
      this.log.error('payment.capture_without_reference', {});
      return CaptureOutcome.failed(null, 'missing_reference');
    }

    if (this.authorizeMode === CheckoutChampAuthorizeMode.Qa) {
      return this.approveQa(reference);
    }

    const lines = request.chargeableLines();
    const campaignId = CheckoutChampPayload.campaignOf(lines);

    if (lines.length === 0 || campaignId === null) {
      this.log.error('payment.capture_lines_unusable', { reference, lines: request.lines.length, chargeable: lines.length });
      return CaptureOutcome.failed(reference, 'lines_unusable');
    }

    let envelope: Envelope;
    try {
      const { response } = await this.apiFactory.create(this.credentials).importOrder(CheckoutChampPayload.forCapture(reference, lines, campaignId, request.promotionCode)).getInObject();
      envelope = asRecord(response) ?? {};
    } catch (e) {
      this.log.error('payment.capture_threw', { reference, exception: e instanceof Error ? e.constructor.name : 'unknown' });
      return CaptureOutcome.failed(reference, 'exception');
    }

    if (envelope.curlError !== undefined) {
      this.log.error('payment.capture_unreachable', { reference });
      return CaptureOutcome.failed(reference, 'transport_error');
    }

    if (!CheckoutChampOutcome.capturedFrom(envelope)) {
      const reason = CheckoutChampAdapter.captureFailureReason(envelope);
      this.log.error('payment.capture_refused', { reference, reason });
      return CaptureOutcome.failed(reference, reason);
    }

    this.log.info('payment.captured', { reference });
    return CaptureOutcome.captured(reference);
  }

  /** Under Qa mode, no lines are ever sent or checked — `forQaApproval` is just `{orderId, action: 'APPROVE'}`. */
  private async approveQa(reference: string): Promise<CaptureOutcome> {
    let envelope: Envelope;
    try {
      const { response } = await this.apiFactory.create(this.credentials).qa(CheckoutChampPayload.forQaApproval(reference)).getInObject();
      envelope = asRecord(response) ?? {};
    } catch (e) {
      this.log.error('payment.capture_threw', { reference, exception: e instanceof Error ? e.constructor.name : 'unknown' });
      return CaptureOutcome.failed(reference, 'exception');
    }

    if (envelope.curlError !== undefined) {
      this.log.error('payment.capture_unreachable', { reference });
      return CaptureOutcome.failed(reference, 'transport_error');
    }

    if (!CheckoutChampOutcome.capturedFrom(envelope)) {
      const reason = CheckoutChampAdapter.captureFailureReason(envelope);
      this.log.error('payment.capture_refused', { reference, reason });
      return CaptureOutcome.failed(reference, reason);
    }

    this.log.info('payment.captured', { reference, mechanism: 'qa' });
    return CaptureOutcome.captured(reference);
  }

  /** Unlike `CheckoutChampOutcome.reason()` (the placement path, with a buyer watching), this flattens a field-map message into readable text — there is no buyer to protect from it on the operator-only capture path. */
  private static captureFailureReason(envelope: Envelope): string {
    const message = envelope.message;

    if (typeof message === 'string' && message.trim() !== '') {
      return CardScrubber.scrub(message.trim()) as string;
    }

    const fieldMap = asRecord(message);
    if (fieldMap && Object.keys(fieldMap).length > 0) {
      const parts = Object.entries(fieldMap).map(([field, problem]) => `${field} ${typeof problem === 'string' || typeof problem === 'number' || typeof problem === 'boolean' ? String(problem) : 'is invalid'}`);
      return CardScrubber.scrub(parts.join('; ')) as string;
    }

    return 'rejected';
  }

  async ping(): Promise<{ ok: boolean; detail: string }> {
    let envelope: Envelope;
    try {
      const { response } = await this.apiFactory.create(this.credentials).campaignQuery({}).getInObject();
      envelope = asRecord(response) ?? {};
    } catch (e) {
      return { ok: false, detail: `checkout_champ ${this.credentials.host} — ${e instanceof Error ? e.message : String(e)}` };
    }

    if (envelope.curlError !== undefined) {
      return { ok: false, detail: `checkout_champ ${this.credentials.host} — unreachable` };
    }

    if (envelope.result !== 'SUCCESS') {
      const message = envelope.message;
      return { ok: false, detail: `checkout_champ ${this.credentials.host} — rejected: ${typeof message === 'string' ? message : 'no reason given'}` };
    }

    const message = asRecord(envelope.message);
    const campaigns = message && Array.isArray(message.data) ? message.data : [];

    return {
      ok: true,
      detail: `checkout_champ ${this.credentials.host} — login ${this.credentials.loginId}, ${campaigns.length} campaign(s) visible, order campaign taken from the catalog, authorize mechanism "${this.authorizeMode}" (${CheckoutChampAuthorizeMode.holdsTheOrderAmount(this.authorizeMode) ? 'holds the order amount' : 'does not hold the order amount'})`,
    };
  }
}
