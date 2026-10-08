import { CardScrubber } from '../../support/card-scrubber';
import { OperatorLog } from '../../support/operator-log';
import { AdapterCapabilities, SCOPE_LINE_ITEM, STRATEGY_ORDER_REFERENCE, SURFACE_THEME_FIELDS } from '../adapter-capabilities';
import { CaptureOutcome } from '../capture-outcome';
import { CaptureRequest } from '../capture-request';
import { OrderEnvelope } from '../order-envelope';
import { OrderSearch } from '../order-search';
import { OrderSearchResult } from '../order-search-result';
import { PaymentAdapter } from '../payment-adapter';
import { PaymentCredential } from '../payment-credential';
import { PlacementOutcome } from '../placement-outcome';
import { ProviderOrder } from '../provider-order';
import { PromotionQuote } from '../promotion-quote';
import { VrioCredentials } from './vrio-credentials';
import { VrioApiFactory } from './vrio-api-factory';
import { VrioOffers } from './vrio-offers';
import { VrioOutcome } from './vrio-outcome';
import { VrioPayload } from './vrio-payload';

type Envelope = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function searchDate(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

/**
 * Ported from storefront-lamp/core/Payment/Vrio/VrioAdapter.php. Real Vrio integration, wrapping
 * `@astermd-hq/vrio-client` (the npm sibling of the PHP original's `astermd/vrio-client` Composer
 * package — both explicitly unofficial, published by the same author as `@astermd-hq/sdk`).
 *
 * A fresh client is built per call via `apiFactory.create()` (never cached on the adapter) —
 * matching the PHP original exactly, and cheap since it's just wiring credentials + a transport.
 */
export class VrioAdapter implements PaymentAdapter {
  constructor(
    private readonly credentials: VrioCredentials,
    private readonly apiFactory: VrioApiFactory,
    private readonly log: OperatorLog,
    private readonly shippingProfileId: number,
  ) {}

  capabilities(): AdapterCapabilities {
    return new AdapterCapabilities(
      'vrio',
      true,
      SCOPE_LINE_ITEM,
      STRATEGY_ORDER_REFERENCE,
      SURFACE_THEME_FIELDS,
      ['api_endpoint', 'api_key', 'campaign_id', 'connection_id'],
      ['campaign_id', 'connection_id'],
      'Reduced scope via reference-order reuse: the card is collected by the storefront once, at checkout, and is never held afterwards — later charges on the same journey name the instrument the provider already holds in its own vault. The collection surface is still the storefront\'s own, so the checkout request itself remains in scope; nothing beyond it is.',
      false,
      false,
      true,
      true,
      ['shipping_profile_id'],
    );
  }

  async place(order: OrderEnvelope, credential: PaymentCredential): Promise<PlacementOutcome> {
    if (order.chargeableLines().length === 0) {
      this.log.error('payment.no_chargeable_lines', { anchor: order.anchorSlug });
      return PlacementOutcome.declined(null, VrioOutcome.GENERIC_DECLINE, 'no_chargeable_lines');
    }

    for (const line of order.unmappedLines()) {
      this.log.info('payment.line_not_sent', { slug: line.slug, free: line.isFree() });
    }

    const paymentFields = VrioPayload.paymentFor(credential);
    if (Object.keys(paymentFields).length === 0) {
      this.log.error('payment.credential_unusable', { kind: credential.kind, anchor: order.anchorSlug });
      return PlacementOutcome.declined(null, VrioOutcome.GENERIC_DECLINE, 'credential_unusable');
    }

    const body = VrioPayload.forOrder(order, credential, this.credentials, this.shippingProfileId);

    let envelope: Envelope;
    try {
      const result = await this.apiFactory.create(this.credentials).addOrder(body).getInArray();
      envelope = asRecord(result.response) ?? {};
    } catch (e) {
      this.log.error('payment.place_threw', { reason: CardScrubber.scrub(e instanceof Error ? e.message : String(e)) });
      return PlacementOutcome.declined(null, VrioOutcome.GENERIC_DECLINE, 'exception');
    }

    const outcome = VrioOutcome.from(envelope, order.totalCents, order.settlement);

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
        promotion_code: order.promotionCode,
        anchor: order.anchorSlug,
      });
    }

    return outcome;
  }

  async quotePromotion(order: OrderEnvelope, code: string): Promise<PromotionQuote> {
    const trimmed = code.trim();
    if (trimmed === '') return PromotionQuote.rejected(trimmed, 'empty');

    const lines = VrioOffers.forQuote(order, trimmed);
    if (lines.length === 0) return PromotionQuote.rejected(trimmed, 'no_offers');

    let response: Envelope;
    try {
      // `calculateDiscount` wraps whatever it is given as the body's `offers` member — the
      // client's own type is a loose `Record<string, unknown>`, but at runtime an array works
      // fine (`{ offers: params }`); see @astermd-hq/vrio-client's own `Discount` resource.
      const result = await this.apiFactory
        .create(this.credentials)
        .calculateDiscount(lines as unknown as Record<string, unknown>)
        .getInArray();
      response = asRecord(result.response) ?? {};
    } catch (e) {
      this.log.warning('payment.promotion_threw', { reason: e instanceof Error ? e.message : String(e) });
      return PromotionQuote.rejected(trimmed, 'unavailable');
    }

    return VrioAdapter.quoteFrom(trimmed, response);
  }

  private static quoteFrom(code: string, response: Envelope): PromotionQuote {
    if (response.curlError !== undefined || response.success !== true) {
      return PromotionQuote.rejected(code, 'unavailable');
    }

    const data = asRecord(response.data);
    const offers = data && Array.isArray(data.offers) ? data.offers : null;
    if (!offers || offers.length === 0) return PromotionQuote.rejected(code, 'invalid');

    let validSomewhere = false;
    let cents = 0;

    for (const rawOffer of offers) {
      const offer = asRecord(rawOffer);
      if (!offer) continue;

      const details = asRecord(offer.discount_details);
      if (details?.discount_code_valid === true) validSomewhere = true;

      const discount = offer.offer_total_discount;
      if (typeof discount === 'number' && Number.isFinite(discount)) {
        cents += Math.round(discount * 100);
      }
    }

    if (!validSomewhere) return PromotionQuote.rejected(code, 'invalid');
    return PromotionQuote.accepted(code, cents);
  }

  async searchOrders(search: OrderSearch): Promise<OrderSearchResult> {
    let envelope: Envelope;
    try {
      const result = await this.apiFactory
        .create(this.credentials)
        .searchOrder({
          campaign_id: this.credentials.campaignId,
          date_created_from: searchDate(search.from),
          date_created_to: searchDate(search.to),
          limit: search.limit,
        })
        .getInArray();
      envelope = asRecord(result.response) ?? (result.response as unknown as Envelope);
    } catch (e) {
      this.log.warning('payment.order_search_threw', { exception: e instanceof Error ? e.constructor.name : 'unknown' });
      return OrderSearchResult.failed('exception');
    }

    if (!envelope || typeof envelope !== 'object' || envelope.curlError !== undefined) {
      this.log.warning('payment.order_search_unreachable', { host: this.credentials.host });
      return OrderSearchResult.failed('transport_error');
    }

    if (envelope.success !== true) {
      this.log.warning('payment.order_search_rejected', { campaign: this.credentials.campaignId });
      return OrderSearchResult.failed('rejected');
    }

    const data = asRecord(envelope.data);
    const orders = data && Array.isArray(data.orders) ? data.orders : null;
    if (!orders) {
      this.log.warning('payment.order_search_unreadable', { campaign: this.credentials.campaignId });
      return OrderSearchResult.failed('unreadable');
    }

    let foreign = 0;
    const mapped: ProviderOrder[] = [];
    for (const rawRow of orders) {
      const row = asRecord(rawRow);
      if (!row) continue;

      const campaignId = typeof row.campaign_id === 'number' ? row.campaign_id : Number(row.campaign_id ?? 0);
      if (campaignId !== this.credentials.campaignId) {
        foreign++;
        continue;
      }

      const order = VrioAdapter.orderFrom(row);
      if (order) mapped.push(order);
    }

    if (foreign > 0) {
      this.log.warning('payment.order_search_foreign_campaign', { campaign: this.credentials.campaignId, dropped: foreign });
    }

    const total = data?.total;
    return OrderSearchResult.of(mapped, typeof total === 'number' ? Math.max(0, total - foreign) : null);
  }

  private static orderFrom(row: Record<string, unknown>): ProviderOrder | null {
    let reference: string | null;
    if (typeof row.order_id === 'number') reference = String(row.order_id);
    else if (typeof row.order_id === 'string' && row.order_id.trim() !== '') reference = row.order_id.trim();
    else reference = null;
    if (reference === null) return null;

    const status = row.status_type_id ?? null;
    const placedAt = typeof row.date_created === 'string' && row.date_created !== '' ? row.date_created : null;
    const discount = row.order_discount;
    const isTest = row.is_test === true;
    const isCharged = !('status_type_id' in row) || status !== null;
    const rawStatus = typeof status === 'string' || typeof status === 'number' ? String(status) : null;
    const discountCents = typeof discount === 'number' || (typeof discount === 'string' && discount.trim() !== '' && !Number.isNaN(Number(discount))) ? Math.round(Number(discount) * 100) : 0;

    return new ProviderOrder(reference, placedAt, isTest, isCharged, rawStatus, discountCents);
  }

  async capture(request: CaptureRequest): Promise<CaptureOutcome> {
    const reference = request.reference.trim();
    if (reference === '') {
      this.log.error('payment.capture_without_reference', {});
      return CaptureOutcome.failed(null, 'missing_reference');
    }

    let envelope: Envelope;
    try {
      const result = await this.apiFactory.create(this.credentials).captureOrder(reference, {}).getInArray();
      envelope = asRecord(result.response) ?? (result.response as unknown as Envelope);
    } catch (e) {
      this.log.error('payment.capture_threw', { reference, exception: e instanceof Error ? e.constructor.name : 'unknown' });
      return CaptureOutcome.failed(reference, 'exception');
    }

    if (!envelope || typeof envelope !== 'object' || envelope.curlError !== undefined) {
      this.log.error('payment.capture_unreachable', { reference });
      return CaptureOutcome.failed(reference, 'transport_error');
    }

    if (envelope.success !== true) {
      const reason = VrioAdapter.captureFailureReason(envelope);
      this.log.error('payment.capture_refused', { reference, reason });
      return CaptureOutcome.failed(reference, reason);
    }

    this.log.info('payment.captured', { reference });
    return CaptureOutcome.captured(reference);
  }

  private static captureFailureReason(envelope: Envelope): string {
    const data = asRecord(envelope.data);
    const error = data ? asRecord(data.error) : null;

    const candidates: unknown[] = [error?.code, envelope.validation_code, envelope.message];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim() !== '') {
        return CardScrubber.scrub(candidate.trim()) as string;
      }
    }

    return 'rejected';
  }

  async ping(): Promise<{ ok: boolean; detail: string }> {
    let response: Envelope;
    try {
      const result = await this.apiFactory.create(this.credentials).getCampaignItems(String(this.credentials.campaignId)).getInArray();
      response = asRecord(result.response) ?? (result.response as unknown as Envelope);
    } catch (e) {
      return { ok: false, detail: `Provider client error: ${e instanceof Error ? e.message : String(e)}` };
    }

    if (!response || typeof response !== 'object' || response.curlError !== undefined) {
      return { ok: false, detail: `Could not reach ${this.credentials.host}` };
    }

    if (response.success !== true) {
      return { ok: false, detail: typeof response.message === 'string' ? response.message : 'Provider rejected the request.' };
    }

    const data = asRecord(response.data);
    const items = data && Array.isArray(data.campaign_items) ? data.campaign_items : [];
    return {
      ok: true,
      detail: `vrio ${this.credentials.host} — campaign ${this.credentials.campaignId}, ${items.length} items, connection ${this.credentials.connectionId}`,
    };
  }
}
