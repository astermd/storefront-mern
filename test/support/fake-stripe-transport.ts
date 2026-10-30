import Stripe from 'stripe';

export interface RecordedStripeRequest {
  method: string;
  path: string;
  headers: Record<string, unknown>;
  params: Record<string, unknown>;
}

type Queued = { status: number; body: string } | Error;

class FakeStripeResponse extends Stripe.HttpClientResponse {
  constructor(
    statusCode: number,
    headers: Record<string, string>,
    private readonly body: string,
  ) {
    super(statusCode, headers);
  }

  /** The SDK stamps the response's headers onto this object, so it must be one. */
  getRawResponse(): unknown {
    return {};
  }

  toStream(): never {
    throw new Error('FakeStripeTransport does not stream.');
  }

  async toJSON(): Promise<unknown> {
    return JSON.parse(this.body);
  }
}

/**
 * Port of storefront-lamp/tests/Support/FakeStripeTransport.php. Stripe's HTTP client, answering
 * from a queue and recording what was asked.
 *
 * Installed through `StripeApiFactory`, exactly where the refusing transport sits under the suite,
 * so the adapter under test is the real one end to end except for the wire. The `stripe` package
 * form-encodes a request before it reaches the transport (`a[b]=c`, `a[0]=x`), so what is recorded
 * is that body decoded back into nested objects and arrays — every scalar a string, as Stripe
 * itself receives it (`true` is `'true'`, 12000 is `'12000'`). A GET's parameters are decoded from
 * the query string the same way.
 */
export class FakeStripeTransport extends Stripe.HttpClient {
  readonly requests: RecordedStripeRequest[] = [];
  private readonly queued: Queued[] = [];

  getClientName(): string {
    return 'fake';
  }

  queue(status: number, body: Record<string, unknown>): void {
    this.queued.push({ status, body: JSON.stringify(body) });
  }

  /** The next request fails as the SDK's own transport fails: by throwing. */
  queueFailure(failure: Error): void {
    this.queued.push(failure);
  }

  params(index: number): Record<string, unknown> {
    const request = this.requests[index];
    if (request === undefined) throw new RangeError(`No request was made at index ${index}.`);

    return request.params;
  }

  header(index: number, name: string): string | null {
    const headers = this.requests[index]?.headers ?? {};
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === name.toLowerCase()) return String(value);
    }

    return null;
  }

  /** The request paths in the order they were made, e.g. `POST /v1/payment_intents`. */
  calls(): string[] {
    return this.requests.map((request) => `${request.method.toUpperCase()} ${request.path}`);
  }

  async makeRequest(
    _host: string,
    _port: string,
    path: string,
    method: string,
    headers: Record<string, unknown>,
    requestData: string,
    _protocol: string,
    _timeout: number,
  ): Promise<Stripe.HttpClientResponse> {
    const [bare, query = ''] = path.split('?');
    this.requests.push({ method, path: bare, headers, params: FakeStripeTransport.decode(requestData !== '' ? requestData : query) });

    const next = this.queued.shift();
    if (next === undefined) throw new Error('No Stripe response was queued for this request.');
    if (next instanceof Error) throw next;

    return new FakeStripeResponse(next.status, { 'request-id': 'req_test' }, next.body);
  }

  /** Decodes a Stripe form body: `a[b][0][c]=d` → `{a: {b: [{c: 'd'}]}}`. */
  private static decode(encoded: string): Record<string, unknown> {
    const root: Record<string, unknown> = {};

    for (const pair of encoded.split('&').filter((part) => part !== '')) {
      const [rawKey, rawValue = ''] = pair.split('=');
      const key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
      const value = decodeURIComponent(rawValue.replace(/\+/g, ' '));
      const segments = [...key.matchAll(/([^[\]]+)/g)].map((match) => match[1]);

      let cursor: Record<string, unknown> = root;
      segments.forEach((segment, position) => {
        if (position === segments.length - 1) {
          cursor[segment] = value;
          return;
        }
        cursor[segment] ??= {};
        cursor = cursor[segment] as Record<string, unknown>;
      });
    }

    return FakeStripeTransport.arrays(root) as Record<string, unknown>;
  }

  /** An object whose keys are `0..n-1` was an array. */
  private static arrays(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return value;

    const entries = Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, FakeStripeTransport.arrays(v)] as const);
    if (entries.length > 0 && entries.every(([k], i) => k === String(i))) return entries.map(([, v]) => v);

    return Object.fromEntries(entries);
  }
}
