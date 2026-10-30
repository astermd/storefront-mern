import Stripe from 'stripe';
import { StripeCredentials } from './stripe-credentials';

/**
 * Ported from storefront-lamp/core/Payment/Stripe/StripeApiFactory.php. Builds the Stripe client
 * the adapter talks through.
 *
 * **The transport is the test-environment fence**, as it is for the other two providers: under the
 * suite it is `StripeRefusingTransport`, so a test that forgot a stub fails instead of creating a
 * payment. Unlike stripe-php (whose HTTP client is process-wide and so is installed on every
 * `create()`), `stripe` for Node takes its client per instance, so it is simply handed to each one.
 * Null leaves the SDK's own Node client in place.
 *
 * **The API version is pinned to the one the EMR reads these payments with.** The EMR reads back
 * what this adapter writes — the line items, the metadata, the saved card — and a payment written
 * under one version and read under another is two shapes of one object. The string is the same one
 * lamp pins, and the installed `stripe` package's own default (`Stripe.API_VERSION`) at the time of
 * the port; pinning it here keeps a future package bump from moving it silently.
 *
 * Retries are off (`maxNetworkRetries: 0`), as stripe-php's default is: the adapter reads a
 * connection failure as "may have been placed" and says so, rather than leaving the SDK to resend
 * behind its back.
 */
export class StripeApiFactory {
  /** The Stripe API version the EMR's sales service pins. */
  static readonly API_VERSION = '2026-09-30.endive';

  constructor(private readonly transport: Stripe.HttpClient | null = null) {}

  create(credentials: StripeCredentials): Stripe {
    const config: Stripe.StripeConfig = { apiVersion: StripeApiFactory.API_VERSION as Stripe.StripeConfig['apiVersion'], maxNetworkRetries: 0 };

    if (this.transport !== null) {
      config.httpClient = this.transport;
    }

    if (credentials.apiBase !== null) {
      const base = new URL(credentials.apiBase);
      config.protocol = base.protocol.replace(':', '') as 'http' | 'https';
      config.host = base.hostname;
      if (base.port !== '') config.port = Number(base.port);
    }

    return new Stripe(credentials.secretKey(), config);
  }
}
