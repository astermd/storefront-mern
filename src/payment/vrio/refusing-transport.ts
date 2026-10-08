import { HttpClientInterface, Request, Response } from '@astermd-hq/vrio-client';

/**
 * Ported from storefront-lamp/core/Payment/RefusingTransport.php. Substituted for the real
 * transport whenever `config.app.env === 'test'` — the adapter itself is chosen from synced
 * channel data rather than from the environment, so unlike every EMR port there is no Null
 * implementation standing between a test and the live provider; this is what stands in its
 * place so the test suite can never place a real order.
 */
export class RefusingTransport implements HttpClientInterface {
  async send(_request: Request): Promise<Response> {
    throw new Error(
      'The payment provider was called from the test environment. Substitute a transport at the adapter seam, or override PAYMENT_ADAPTER in the container. Refusing to send so a missing stub cannot place a real order.',
    );
  }
}
