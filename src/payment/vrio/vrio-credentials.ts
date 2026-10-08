import { inspect } from 'node:util';

/**
 * Ported from storefront-lamp/core/Payment/Vrio/VrioCredentials.php. The channel's
 * `payment_processor.config` as this provider's client needs it.
 *
 * `campaignId`/`connectionId` are routing hints the storefront passes through and never
 * interprets. The API key is kept out of every serialisation path (`toJSON`/`util.inspect`) —
 * see `payment-credential.ts` for the identical Node redaction idiom this mirrors.
 */
export class VrioCredentials {
  private constructor(
    public readonly host: string,
    public readonly basePath: string,
    private readonly apiKeyValue: string,
    public readonly campaignId: number,
    public readonly connectionId: number,
  ) {}

  /** @param config the channel's `payment_processor.config` */
  static fromChannelConfig(config: Record<string, unknown>): VrioCredentials {
    const apiKey = String(config.api_key ?? '').trim();
    if (apiKey === '') {
      throw new Error('The payment processor configuration carries no api_key.');
    }

    const [host, basePath] = VrioCredentials.splitEndpoint(String(config.api_endpoint ?? '').trim());
    if (host === '') {
      throw new Error('The payment processor configuration carries no usable api_endpoint.');
    }

    return new VrioCredentials(host, basePath, apiKey, Number(config.campaign_id ?? 0) | 0, Number(config.connection_id ?? 0) | 0);
  }

  /** The key, for the one caller that builds the client. A method, not a property, so it never appears in an object dump. */
  apiKey(): string {
    return this.apiKeyValue;
  }

  toJSON(): Record<string, unknown> {
    return { host: this.host, basePath: this.basePath, campaignId: this.campaignId, connectionId: this.connectionId, apiKey: '[REDACTED]' };
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
