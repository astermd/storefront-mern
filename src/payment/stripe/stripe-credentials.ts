import { inspect } from 'node:util';

/**
 * Ported from storefront-lamp/core/Payment/Stripe/StripeCredentials.php. The channel's Stripe
 * credentials, as `theme:sync` copied them from the EMR's `payment_processor.config`.
 *
 * Two keys with opposite rules. The secret key (`api_key`, an `sk_` or restricted `rk_` key)
 * creates and reads payments and must never leave this process: it is private, redacted from
 * `JSON.stringify` and `util.inspect`, the same treatment `VrioCredentials` gives its key. The
 * publishable key (`pk_`) exists to be put on the page — Stripe's own script needs it to mount the
 * card fields — so it is public.
 *
 * `api_endpoint` is optional: the EMR stores Stripe's API origin with the integration, and an empty
 * one means Stripe's default.
 *
 * PHP's `__unserialize` refusal has no equivalent here, for the reason `PaymentCredential` states:
 * nothing in this codebase rebuilds a class instance from a serialised copy.
 */
export class StripeCredentials {
  constructor(
    private readonly secret: string,
    public readonly publishableKey: string,
    public readonly apiBase: string | null = null,
  ) {}

  /** @param config the channel's `payment_processor.config` */
  static fromChannelConfig(config: Record<string, unknown>): StripeCredentials {
    const secret = String(config.api_key ?? '').trim();
    if (secret === '') {
      throw new Error('The payment processor configuration carries no api_key.');
    }

    const publishable = String(config.publishable_key ?? '').trim();
    if (publishable === '') {
      throw new Error('The payment processor configuration carries no publishable_key.');
    }

    const endpoint = String(config.api_endpoint ?? '').trim().replace(/\/+$/, '');

    return new StripeCredentials(secret, publishable, endpoint === '' ? null : endpoint);
  }

  /** The secret key, for the one caller that builds the client. A method, not a property, so it never appears in an object dump. */
  secretKey(): string {
    return this.secret;
  }

  toJSON(): Record<string, string | null> {
    return { publishableKey: this.publishableKey, apiBase: this.apiBase, secretKey: '[REDACTED]' };
  }

  [inspect.custom](): Record<string, string | null> {
    return this.toJSON();
  }
}
