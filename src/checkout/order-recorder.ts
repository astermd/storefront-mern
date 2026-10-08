import { OrderEnvelope } from '../payment/order-envelope';
import { PaymentCredential } from '../payment/payment-credential';
import { PlacementOutcome } from '../payment/placement-outcome';
import { ConsentRecord } from './consent-record';

/**
 * Ported from storefront-lamp/core/Checkout/OrderRecorder.php (interface). The storefront's own
 * record of what was bought (`[18.1]`).
 *
 * A port rather than a concrete class so `CheckoutService` depends on the *fact* that a placement is
 * recorded, not on the table it lands in. **No card ever crosses this boundary intact** — the
 * credential is passed so an implementation can take `PaymentCredential.lastFour()` for a receipt,
 * and nothing more (`[15.8]`).
 */
export interface OrderRecorder {
  /**
   * Records one placement — header, lines and consents — and returns the local row id, or null when
   * nothing was written. A null return is not an error the buyer may see: by the time this is called
   * the money has already moved, so an implementation that cannot write must log and return null
   * rather than throw (`[20.1]`).
   */
  record(
    order: OrderEnvelope,
    outcome: PlacementOutcome,
    credential: PaymentCredential,
    consents: ConsentRecord[],
    providerCategory: string,
    isUpsell?: boolean,
  ): Promise<number | null>;
}
