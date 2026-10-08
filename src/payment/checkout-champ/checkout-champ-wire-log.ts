import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { HttpClientInterface, Request, Response } from '@astermd-hq/checkoutchamp-client';

/**
 * Ported from storefront-lamp/core/Payment/CheckoutChamp/CheckoutChampWireLog.php. Decorates
 * whichever transport it is given rather than replacing it. Off by default, gated by
 * `config.app.debug.wireLog`.
 *
 * **Writes the exchange verbatim — no redaction at all.** Because this provider authenticates
 * and sends every parameter (including the card number and security code) in the query string,
 * this log — while on — carries the raw password and cardholder data in clear text on disk. Must
 * never be enabled in a deployment taking real payments. Every write failure is swallowed; a
 * debugging aid must never break checkout.
 */
export class CheckoutChampWireLog implements HttpClientInterface {
  constructor(
    private readonly inner: HttpClientInterface,
    private readonly logFile: string,
  ) {}

  async send(request: Request): Promise<Response> {
    const startedAt = Date.now();
    const response = await this.inner.send(request);

    this.write({
      at: new Date().toISOString(),
      ms: Date.now() - startedAt,
      request: {
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: CheckoutChampWireLog.decodeIfJson(request.body),
      },
      response: {
        status: response.statusCode,
        transport_error: response.transportError,
        body: CheckoutChampWireLog.decodeIfJson(response.body),
      },
    });

    return response;
  }

  private static decodeIfJson(body: string | null): unknown {
    if (body === null || body === '') return null;
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }

  private write(entry: Record<string, unknown>): void {
    try {
      mkdirSync(dirname(this.logFile), { recursive: true });
      appendFileSync(this.logFile, JSON.stringify(entry) + '\n');
    } catch {
      // A debugging aid must never break checkout.
    }
  }
}
