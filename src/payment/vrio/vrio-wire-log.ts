import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { HttpClientInterface, Request, Response } from '@astermd-hq/vrio-client';

/**
 * Ported from storefront-lamp/core/Payment/Vrio/VrioWireLog.php. Decorates whichever transport it
 * is given rather than replacing it, so behaviour is identical whether wire logging is on or off.
 *
 * Off by default, gated by `config.app.debug.wireLog`. **Writes the exchange verbatim — no
 * redaction at all** (unlike every other log in this port): while on, the log file carries raw
 * card numbers and the API key in clear text, for exact-replay debugging. Must never be enabled in
 * a deployment taking real payments — see `config/app.ts`'s own doc comment on this flag. Every
 * write failure is swallowed; a debugging aid must never break checkout.
 */
export class VrioWireLog implements HttpClientInterface {
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
        method: request.getMethod(),
        url: request.getUrl(),
        headers: request.getHeaders(),
        body: VrioWireLog.decodeIfJson(request.getBody()),
      },
      response: {
        status: response.getStatusCode(),
        transport_error: response.getTransportError(),
        body: VrioWireLog.decodeIfJson(response.getBody()),
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
