import { PaymentDescriptor } from '../payment/payment-descriptor';
import { Totals } from './totals';

/**
 * Ported from storefront-lamp/core/Checkout/CheckoutEventReporter.php (interface). Reports checkout
 * funnel events to the EMR — a port, not called directly from `CheckoutService`'s tests, so a
 * failure here can never become the buyer's problem (`[20.1]`); every call site wraps these in
 * `PostChargeGuard.run()` once the charge has happened, and the pre-charge `checkoutVisited()` call
 * degrades silently on its own.
 *
 * Not yet bound to a real EMR-backed implementation in this port — see `NullCheckoutEventReporter`'s
 * doc comment for why that is a deliberately bounded gap, not an oversight.
 */
export interface CheckoutEventReporter {
  checkoutVisited(sessionUuid: string | null, totals: Totals): Promise<void>;
  orderPlaced(sessionUuid: string | null, totals: Totals, paymentMethod: string, references: string[], payment: PaymentDescriptor): Promise<void>;
  orderDeclined(sessionUuid: string | null, totals: Totals, paymentMethod: string, reference: string | null, reason: string, payment: PaymentDescriptor | null): Promise<void>;
  orderBump(sessionUuid: string | null, slug: string, accepted: boolean): Promise<void>;
  /** `[16.7]`: fired once per offer, the moment it is first shown. */
  upsellOffered(sessionUuid: string | null, slug: string, name: string): Promise<void>;
  upsellAccepted(sessionUuid: string | null, slug: string, name: string): Promise<void>;
  /** Covers both an outright decline and a charge the provider refused — `UpsellService` reports both this way. */
  upsellDeclined(sessionUuid: string | null, slug: string, name: string): Promise<void>;
  /** `[17.6]`: the funnel's final event, batching every reference the journey placed. */
  journeyCompleted(
    sessionUuid: string | null,
    placed: boolean,
    subtotalCents: number,
    paidTotalCents: number,
    paymentMethod: string | null,
    references: string[],
    opportunityId: string | null,
  ): Promise<void>;
  /** `[17.2]`: tells the EMR which of this journey's orders to sync as treatments. */
  treatmentsSynced(sessionUuid: string | null, references: string[], payment?: PaymentDescriptor | null): Promise<void>;
}
