import { Injectable } from '@nestjs/common';
import { PaymentDescriptor } from '../payment/payment-descriptor';
import { SyncedPayment } from './checkout-event-reporter';
import { CheckoutEventReporter } from './checkout-event-reporter';
import { Totals } from './totals';

/**
 * Ported from storefront-lamp/core/Checkout/NullCheckoutEventReporter.php. Every method is a no-op.
 *
 * Used when `session.analytics` is off (or `NODE_ENV=test`) — see `EmrCheckoutEventReporter` for
 * the real implementation, bound instead whenever analytics is on.
 */
@Injectable()
export class NullCheckoutEventReporter implements CheckoutEventReporter {
  async checkoutVisited(_sessionUuid: string | null, _totals: Totals): Promise<void> {}

  async orderPlaced(
    _sessionUuid: string | null,
    _totals: Totals,
    _paymentMethod: string,
    _references: string[],
    _payment: PaymentDescriptor,
  ): Promise<void> {}

  async orderDeclined(
    _sessionUuid: string | null,
    _totals: Totals,
    _paymentMethod: string,
    _reference: string | null,
    _reason: string,
    _payment: PaymentDescriptor | null,
  ): Promise<void> {}

  async orderBump(_sessionUuid: string | null, _slug: string, _accepted: boolean): Promise<void> {}

  async upsellOffered(_sessionUuid: string | null, _slug: string, _name: string): Promise<void> {}

  async upsellAccepted(_sessionUuid: string | null, _slug: string, _name: string): Promise<void> {}

  async upsellDeclined(_sessionUuid: string | null, _slug: string, _name: string): Promise<void> {}

  async journeyCompleted(
    _sessionUuid: string | null,
    _placed: boolean,
    _subtotalCents: number,
    _paidTotalCents: number,
    _paymentMethod: string | null,
    _references: string[],
    _opportunityId: string | null,
  ): Promise<void> {}

  async treatmentsSynced(_sessionUuid: string | null, _references: string[], _payment: SyncedPayment | null = null): Promise<void> {}
}
