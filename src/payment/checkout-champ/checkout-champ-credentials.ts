import { inspect } from 'node:util';

/**
 * Ported from storefront-lamp/core/Payment/CheckoutChamp/CheckoutChampCredentials.php.
 *
 * This provider authenticates with a password sent in the query string — the provider's own
 * design, followed as-is by its client. That makes the secret here categorically more exposed
 * than an `Authorization` header would be, which is why `capabilities()`'s PCI posture string
 * calls it out explicitly rather than leaving it for someone to discover.
 *
 * No `campaignId` here, unlike Vrio's credentials — campaign is a *per-line* routing hint on this
 * provider (a variant's `provider.offer_id`), resolved per order by `CheckoutChampPayload`.
 */
export class CheckoutChampCredentials {
  private constructor(
    public readonly host: string,
    public readonly basePath: string,
    public readonly loginId: string,
    private readonly passwordValue: string,
  ) {}

  /** @param config the channel's `payment_processor.config` */
  static fromChannelConfig(config: Record<string, unknown>): CheckoutChampCredentials {
    const loginId = String(config.api_username ?? '').trim();
    const password = String(config.api_password ?? '').trim();
    if (loginId === '' || password === '') {
      throw new Error('The payment processor configuration carries no api_username/api_password pair.');
    }

    const [host, basePath] = CheckoutChampCredentials.splitEndpoint(String(config.api_endpoint ?? '').trim());
    if (host === '') {
      throw new Error('The payment processor configuration carries no usable api_endpoint.');
    }

    return new CheckoutChampCredentials(host, basePath, loginId, password);
  }

  /** The password, for the one caller that builds the client. A method, not a property, so it never appears in an object dump. */
  password(): string {
    return this.passwordValue;
  }

  toJSON(): Record<string, unknown> {
    return { host: this.host, basePath: this.basePath, loginId: this.loginId, password: '[REDACTED]' };
  }

  [inspect.custom](): Record<string, unknown> {
    return this.toJSON();
  }

  private static splitEndpoint(endpoint: string): [string, string] {
    if (endpoint === '') return ['', ''];

    const withScheme = endpoint.includes('://') ? endpoint : `https://${endpoint}`;

    try {
      const url = new URL(withScheme);
      return [url.hostname, url.pathname.replace(/^\/+|\/+$/g, '')];
    } catch {
      return ['', ''];
    }
  }
}
