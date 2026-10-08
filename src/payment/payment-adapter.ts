import { AdapterCapabilities } from './adapter-capabilities';
import { CaptureOutcome } from './capture-outcome';
import { CaptureRequest } from './capture-request';
import { OrderEnvelope } from './order-envelope';
import { OrderSearch } from './order-search';
import { OrderSearchResult } from './order-search-result';
import { PaymentCredential } from './payment-credential';
import { PlacementOutcome } from './placement-outcome';
import { PromotionQuote } from './promotion-quote';

/**
 * Ported from storefront-lamp/core/Payment/PaymentAdapter.php — the contract every payment
 * provider integration implements.
 *
 * `place()` must never throw for provider-side outcomes — a decline is a `PlacementOutcome`, not
 * an exception. `searchOrders()` and `capture()` must never throw at all (stronger — `capture()`
 * runs on a reconciliation sweep with no buyer waiting on the other end of it).
 */
export interface PaymentAdapter {
  capabilities(): AdapterCapabilities;
  place(order: OrderEnvelope, credential: PaymentCredential): Promise<PlacementOutcome>;
  quotePromotion(order: OrderEnvelope, code: string): Promise<PromotionQuote>;
  searchOrders(search: OrderSearch): Promise<OrderSearchResult>;
  capture(request: CaptureRequest): Promise<CaptureOutcome>;
  ping(): Promise<{ ok: boolean; detail: string }>;
}
