import { CheckoutEventReporter } from '../checkout/checkout-event-reporter';
import { Totals } from '../checkout/totals';
import { PaymentDescriptor } from '../payment/payment-descriptor';
import { Boundary, BoundaryValue } from './boundary';
import { BoundaryTimer } from './boundary-timer';

/**
 * Ported from storefront-lamp/core/Observability/InstrumentedCheckoutEventReporter.php. `[20.9]`
 * over the treatment sync and the §17 funnel events.
 *
 * **Every method returns void by contract**, so nothing here has an outcome to describe: the port
 * reports success and failure identically because an order that was charged is not un-charged when
 * the EMR does not hear about it (`[20.1]`). What is left — that the call happened, and how long it
 * took — is still the difference between a funnel that stopped converting and one that stopped
 * reporting.
 *
 * Totals travel as integer cents. Order references are counted, not listed. Every argument is
 * forwarded to the inner reporter unchanged — what this class chooses is only what to *measure*.
 */
export class InstrumentedCheckoutEventReporter implements CheckoutEventReporter {
  constructor(
    private readonly inner: CheckoutEventReporter,
    private readonly timer: BoundaryTimer,
  ) {}

  async checkoutVisited(sessionUuid: string | null, totals: Totals): Promise<void> {
    await this.report(Boundary.CheckoutEvent, 'checkout_visited', sessionUuid, { total_cents: totals.totalCents }, () => this.inner.checkoutVisited(sessionUuid, totals));
  }

  async orderPlaced(sessionUuid: string | null, totals: Totals, paymentMethod: string, references: string[], payment: PaymentDescriptor): Promise<void> {
    await this.report(
      Boundary.CheckoutEvent,
      'order_placed',
      sessionUuid,
      { total_cents: totals.totalCents, payment_method: paymentMethod, orders: references.length },
      () => this.inner.orderPlaced(sessionUuid, totals, paymentMethod, references, payment),
    );
  }

  async orderDeclined(sessionUuid: string | null, totals: Totals, paymentMethod: string, reference: string | null, reason: string, payment: PaymentDescriptor | null): Promise<void> {
    // `reason` is the provider's own sentence and is deliberately absent — see InstrumentedPaymentAdapter's doc comment.
    await this.report(
      Boundary.CheckoutEvent,
      'order_declined',
      sessionUuid,
      { total_cents: totals.totalCents, payment_method: paymentMethod, reference },
      () => this.inner.orderDeclined(sessionUuid, totals, paymentMethod, reference, reason, payment),
    );
  }

  async orderBump(sessionUuid: string | null, slug: string, accepted: boolean): Promise<void> {
    await this.report(Boundary.CheckoutEvent, 'order_bump', sessionUuid, { slug, accepted }, () => this.inner.orderBump(sessionUuid, slug, accepted));
  }

  async upsellOffered(sessionUuid: string | null, slug: string, name: string): Promise<void> {
    await this.report(Boundary.CheckoutEvent, 'upsell_offered', sessionUuid, { slug }, () => this.inner.upsellOffered(sessionUuid, slug, name));
  }

  async upsellAccepted(sessionUuid: string | null, slug: string, name: string): Promise<void> {
    await this.report(Boundary.CheckoutEvent, 'upsell_accepted', sessionUuid, { slug }, () => this.inner.upsellAccepted(sessionUuid, slug, name));
  }

  async upsellDeclined(sessionUuid: string | null, slug: string, name: string): Promise<void> {
    await this.report(Boundary.CheckoutEvent, 'upsell_declined', sessionUuid, { slug }, () => this.inner.upsellDeclined(sessionUuid, slug, name));
  }

  async journeyCompleted(
    sessionUuid: string | null,
    placed: boolean,
    subtotalCents: number,
    paidTotalCents: number,
    paymentMethod: string | null,
    references: string[],
    opportunityId: string | null,
  ): Promise<void> {
    await this.report(
      Boundary.CheckoutEvent,
      'journey_completed',
      sessionUuid,
      { any_order_placed: placed, order_value_cents: subtotalCents, paid_total_cents: paidTotalCents, payment_method: paymentMethod, orders: references.length, opportunity: opportunityId },
      () => this.inner.journeyCompleted(sessionUuid, placed, subtotalCents, paidTotalCents, paymentMethod, references, opportunityId),
    );
  }

  async treatmentsSynced(sessionUuid: string | null, references: string[]): Promise<void> {
    await this.report(Boundary.TreatmentSync, 'treatments_synced', sessionUuid, { orders: references.length }, () => this.inner.treatmentsSynced(sessionUuid, references));
  }

  private async report(boundary: BoundaryValue, operation: string, sessionUuid: string | null, context: Record<string, unknown>, call: () => Promise<void>): Promise<void> {
    await this.timer.measure(boundary, call, undefined, { operation, session: sessionUuid, ...context });
  }
}
