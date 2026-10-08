import { Injectable } from '@nestjs/common';
import { OrderEnvelope } from '../payment/order-envelope';
import { PaymentCredential } from '../payment/payment-credential';
import { PlacementOutcome } from '../payment/placement-outcome';
import { OperatorLog } from '../support/operator-log';
import { ConsentRecord } from './consent-record';
import { OrderRecorder } from './order-recorder';

/**
 * Ported from storefront-lamp/core/Checkout/NullOrderRecorder.php. Always returns null and logs
 * that nothing was written.
 *
 * **Must not ship to production.** Every placed order becomes unrecoverable local history under
 * this implementation — no receipt data, no reconciliation trail. It exists for tests and for a
 * deployment that has deliberately not wired persistence; `CoreModule` binds `DatabaseOrderRecorder`
 * in every real environment.
 */
@Injectable()
export class NullOrderRecorder implements OrderRecorder {
  constructor(private readonly log: OperatorLog) {}

  async record(
    _order: OrderEnvelope,
    _outcome: PlacementOutcome,
    _credential: PaymentCredential,
    _consents: ConsentRecord[],
    _providerCategory: string,
    _isUpsell = false,
  ): Promise<number | null> {
    this.log.warning('checkout.order_not_recorded', { reason: 'NullOrderRecorder is bound; nothing was written.' });
    return null;
  }
}
