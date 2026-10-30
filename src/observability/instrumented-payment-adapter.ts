import { AdapterCapabilities } from '../payment/adapter-capabilities';
import { CaptureOutcome } from '../payment/capture-outcome';
import { CaptureRequest } from '../payment/capture-request';
import { OrderEnvelope } from '../payment/order-envelope';
import { OrderSearch } from '../payment/order-search';
import { OrderSearchResult } from '../payment/order-search-result';
import { PaymentAdapter } from '../payment/payment-adapter';
import { PaymentCredential } from '../payment/payment-credential';
import { PlacementOutcome } from '../payment/placement-outcome';
import { PromotionQuote } from '../payment/promotion-quote';
import { Boundary } from './boundary';
import { BoundaryTimer } from './boundary-timer';

/**
 * Ported from storefront-lamp/core/Observability/InstrumentedPaymentAdapter.php. `[20.9]` over the
 * provider boundary: placement, resume, promotion, and the reverse sweep's order search.
 *
 * This is the boundary where a rising latency is a business fact rather than an engineering one — a
 * provider that has slowed to eight seconds converts worse than one that declines outright.
 *
 * **Three things are deliberately not instrumented.** `capabilities()` answers from the adapter's
 * own construction and reaches nothing. `ping()` is an operator smoke test that already prints its
 * own result. Both pass straight through.
 *
 * **What is recorded about a placement is its state and the provider's own status vocabulary —
 * never the decline reason.** The reason is text the provider composed and is shown to the buyer
 * (`[13.28]`); `[20.6]`/`[20.14]` keep somebody else's sentence about our order out of the log.
 */
export class InstrumentedPaymentAdapter implements PaymentAdapter {
  constructor(
    private readonly inner: PaymentAdapter,
    private readonly timer: BoundaryTimer,
  ) {}

  capabilities(): AdapterCapabilities {
    return this.inner.capabilities();
  }

  async place(order: OrderEnvelope, credential: PaymentCredential): Promise<PlacementOutcome> {
    return this.timer.measure(
      Boundary.ProviderPlacement,
      () => this.inner.place(order, credential),
      (outcome) => ({
        outcome: outcome.state,
        raw_status: outcome.rawStatus,
        reference: outcome.reference,
        discrepancy: outcome.hasChargeDiscrepancy(),
        settlement: outcome.settlement,
      }),
      { session: order.sessionUuid, lines: order.lines.length, total_cents: order.totalCents, currency: order.currency },
    );
  }

  /**
   * Timed like a placement, because it finishes one. The client action is deliberately absent from
   * what is recorded: it can confirm the payment, and it never outlives the request.
   */
  async resume(reference: string): Promise<PlacementOutcome> {
    return this.timer.measure(
      Boundary.ProviderResume,
      () => this.inner.resume(reference),
      (outcome) => ({ outcome: outcome.state, raw_status: outcome.rawStatus, reference: outcome.reference, settlement: outcome.settlement }),
      { reference },
    );
  }

  async quotePromotion(order: OrderEnvelope, code: string): Promise<PromotionQuote> {
    return this.timer.measure(
      Boundary.PromotionQuote,
      () => this.inner.quotePromotion(order, code),
      (quote) => ({ outcome: quote.accepted ? 'accepted' : 'rejected', discount_cents: quote.discountCents }),
      { session: order.sessionUuid, code },
    );
  }

  async searchOrders(search: OrderSearch): Promise<OrderSearchResult> {
    return this.timer.measure(
      Boundary.ProviderOrderSearch,
      () => this.inner.searchOrders(search),
      (result) => ({
        // An unanswered search and an empty one are separated here for the reason the result object
        // separates them: a sweep that read an outage as "no orders were lost" is the silent failure
        // reconciliation exists to end (`[21.9a]`).
        outcome: result.failureReason === OrderSearchResult.UNSUPPORTED ? 'unsupported' : !result.ok ? 'failed' : 'ok',
        failure_reason: result.failureReason,
        orders: result.orders.length,
        reported_total: result.reportedTotal,
        truncated: result.truncated(),
      }),
      { limit: search.limit },
    );
  }

  /** Timed like a placement, because it is one half of the same charge — a deployment that authorizes has split one debit across two calls. */
  async capture(request: CaptureRequest): Promise<CaptureOutcome> {
    return this.timer.measure(
      Boundary.ProviderCapture,
      () => this.inner.capture(request),
      (outcome) => ({ outcome: outcome.state, reference: outcome.reference }),
      { reference: request.reference, lines: request.lines.length },
    );
  }

  async ping(): Promise<{ ok: boolean; detail: string }> {
    return this.inner.ping();
  }
}
