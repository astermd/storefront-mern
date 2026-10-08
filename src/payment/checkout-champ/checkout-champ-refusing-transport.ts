import { HttpClientInterface, Request, Response } from '@astermd-hq/checkoutchamp-client';

/**
 * Ported from storefront-lamp/core/Payment/CheckoutChamp/CheckoutChampRefusingTransport.php — this
 * provider's own copy of the same pattern as Vrio's `RefusingTransport`, duplicated per provider
 * deliberately: each provider's client declares its own `HttpClientInterface`, so a transport has
 * to implement the one its own client will accept. Substituted for the real transport whenever
 * `config.app.env === 'test'`, so no test in the suite can ever reach the live provider.
 */
export class CheckoutChampRefusingTransport implements HttpClientInterface {
  async send(_request: Request): Promise<Response> {
    throw new Error(
      'The payment provider was called from the test environment. Substitute a transport at the adapter seam, or override PAYMENT_ADAPTER in the container. Refusing to send so a missing stub cannot place a real order.',
    );
  }
}
