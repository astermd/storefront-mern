import Stripe from 'stripe';

/**
 * Ported from storefront-lamp/core/Payment/Stripe/StripeRefusingTransport.php. Stripe's HTTP client
 * under the test environment: refuses to send.
 *
 * The third provider's half of the fence `RefusingTransport` (Vrio) and
 * `CheckoutChampRefusingTransport` are for theirs: the adapter is chosen from synced channel data
 * rather than from the environment, so nothing else stands between a test and a real payment.
 * Stripe's SDK declares its own client interface, so it gets its own fence.
 */
export class StripeRefusingTransport extends Stripe.HttpClient {
  getClientName(): string {
    return 'refusing';
  }

  async makeRequest(): Promise<Stripe.HttpClientResponse> {
    throw new Error(
      'The payment provider was called from the test environment. Substitute a transport at the adapter seam, or override PAYMENT_ADAPTER in the container. Refusing to send so a missing stub cannot create a real payment.',
    );
  }
}
