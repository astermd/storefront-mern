import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Stripe from 'stripe';

type Headers = Record<string, string | number | string[]>;

/**
 * Ported from storefront-lamp/core/Payment/Stripe/StripeWireLog.php. Writes every Stripe request
 * and response to a file, **verbatim** — the counterpart to `VrioWireLog` and `CheckoutChampWireLog`
 * for the SDK that declares its own HTTP client.
 *
 * **What it costs.** The card never reaches this application — Elements tokenises it in the
 * browser — so there is no primary account number here. But every request carries this
 * deployment's **secret key** in its `Authorization` header, and the bodies carry the buyer's
 * email, name and address alongside the amount. A redacted transcript cannot be replayed by hand,
 * so the key is written as sent, and the file is a secret to be destroyed rather than a log to be
 * shipped. The guard rails are the other two logs': off by default (only `app.debug.wireLog`,
 * `WIRE_LOG=true`, turns it on) and written under `storage/`, which is gitignored.
 *
 * The decorator hands the SDK an answer it reads exactly as it would have read the inner one, and
 * rethrows what the inner client threw, so behaviour with the log on and off is identical. Node's
 * response body is a one-shot stream, so it is read once here and replayed to the SDK. A failure
 * to connect is written too: that is the call a transcript is most often wanted for.
 */
export class StripeWireLog extends Stripe.HttpClient {
  constructor(
    private readonly inner: Stripe.HttpClient,
    private readonly logFile: string,
  ) {
    super();
  }

  getClientName(): string {
    return this.inner.getClientName();
  }

  async makeRequest(
    host: string,
    port: string,
    path: string,
    method: string,
    headers: Headers,
    requestData: string,
    protocol: string,
    timeout: number,
  ): Promise<Stripe.HttpClientResponse> {
    const startedAt = Date.now();
    const request = {
      method: method.toUpperCase(),
      url: `${protocol}://${host}${port && !['80', '443'].includes(String(port)) ? `:${port}` : ''}${path}`,
      headers,
      params: StripeWireLog.decodeForm(requestData),
    };

    let answer: Stripe.HttpClientResponse;
    try {
      answer = (await this.inner.makeRequest(host, port, path, method, headers as never, requestData, protocol, timeout)) as Stripe.HttpClientResponse;
    } catch (e) {
      this.write({ at: new Date().toISOString(), ms: Date.now() - startedAt, request, response: { transport_error: `${(e as Error)?.constructor?.name ?? 'Error'}: ${(e as Error)?.message ?? String(e)}` } });
      throw e;
    }

    // Read once, then replayed: the SDK gets the same parsed body, or the same failure, it would
    // have read from the inner response.
    const body: Promise<unknown> = Promise.resolve().then(() => answer.toJSON());
    let logged: unknown;
    try {
      logged = await body;
    } catch (e) {
      logged = { body_error: (e as Error)?.message ?? String(e) };
    }

    this.write({
      at: new Date().toISOString(),
      ms: Date.now() - startedAt,
      request,
      response: { status: answer.getStatusCode(), request_id: StripeWireLog.header(answer.getHeaders(), 'request-id'), body: logged },
    });

    return new ReplayedResponse(answer, body);
  }

  /** Stripe's own id for the call, which is what its support asks for first. */
  private static header(headers: Record<string, unknown>, name: string): string | null {
    for (const [key, value] of Object.entries(headers ?? {})) {
      if (key.toLowerCase() === name) return Array.isArray(value) ? String(value[0] ?? '') : String(value);
    }
    return null;
  }

  /** The form-encoded body as the readable key/value map it was built from; raw when it is not one. */
  private static decodeForm(requestData: string): unknown {
    if (requestData === '' || requestData === undefined || requestData === null) return null;
    try {
      return Object.fromEntries(new URLSearchParams(requestData));
    } catch {
      return requestData;
    }
  }

  /** One line per call. Failures are swallowed: a debugging aid that could take a checkout down would be a worse bug than whatever it was switched on to find. */
  private write(entry: Record<string, unknown>): void {
    try {
      mkdirSync(dirname(this.logFile), { recursive: true });
      appendFileSync(this.logFile, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    } catch {
      // Intentionally ignored: see the method doc.
    }
  }
}

/** The inner response with its body already read: the SDK's `toJSON()` gets that same result. */
class ReplayedResponse extends Stripe.HttpClientResponse {
  constructor(
    private readonly inner: Stripe.HttpClientResponse,
    private readonly body: Promise<unknown>,
  ) {
    super(inner.getStatusCode(), inner.getHeaders());
  }

  getRawResponse(): unknown {
    return this.inner.getRawResponse();
  }

  toStream(): unknown {
    throw new Error('StripeWireLog has already read this response; streamed responses are not supported with WIRE_LOG on.');
  }

  toJSON(): Promise<unknown> {
    return this.body;
  }
}
