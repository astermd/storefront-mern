import { SettlementModeValue } from './settlement-mode';
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
 * The contract every payment
 * provider integration implements.
 *
 * `place()` must never throw for provider-side outcomes — a decline is a `PlacementOutcome`, not
 * an exception. `searchOrders()` and `capture()` must never throw at all (stronger — `capture()`
 * runs on a reconciliation sweep with no buyer waiting on the other end of it).
 */
export interface PaymentAdapter {
  capabilities(): AdapterCapabilities;
  place(order: OrderEnvelope, credential: PaymentCredential): Promise<PlacementOutcome>;
  /**
   * Re-reads an order `place()` left pending and says what has happened to it since (`[14.22]`) —
   * the second half of the challenge round trip. Answers placed, declined, or still pending (the
   * last carrying `clientAction`, for the page to show the challenge again).
   *
   * Only meaningful when `capabilities().supportsClientAction` is true; an adapter that declares it
   * false answers a decline for the reference and is never asked in the first place. Must never
   * throw for a provider-side outcome, for the reason `place()` must not: a buyer is waiting.
   */
  resume(reference: string): Promise<PlacementOutcome>;
  quotePromotion(order: OrderEnvelope, code: string): Promise<PromotionQuote>;
  /**
   * What this adapter will actually do with the order's money, after any narrowing the provider
   * applies to the cart's `settlement` (Stripe holds only an order with a prescription in it, for
   * one). The checkout page is set up from it, so it promises what the submit will do. Optional: an
   * adapter without it settles exactly as the cart says.
   */
  settlementFor?(order: OrderEnvelope): SettlementModeValue;
  searchOrders(search: OrderSearch): Promise<OrderSearchResult>;
  capture(request: CaptureRequest): Promise<CaptureOutcome>;
  ping(): Promise<{ ok: boolean; detail: string }>;
}
