import { API, ClientOptions, HttpClientInterface } from '@astermd-hq/checkoutchamp-client';
import { CheckoutChampCredentials } from './checkout-champ-credentials';

/**
 * Ported from storefront-lamp/core/Payment/CheckoutChamp/CheckoutChampApiFactory.php. `timeout`
 * and `connectTimeout` are hardcoded, not read from config, matching the PHP original. The
 * package's own debug logging is deliberately never turned on here; wire logging (when enabled)
 * decorates whichever transport this factory is given — see `CheckoutChampWireLog`.
 */
export class CheckoutChampApiFactory {
  constructor(private readonly transport: HttpClientInterface | null = null) {}

  create(credentials: CheckoutChampCredentials): API {
    const options: ClientOptions = { host: credentials.host, timeout: 30, connectTimeout: 10 };
    if (credentials.basePath !== '') {
      options.basePath = credentials.basePath;
    }

    return new API(credentials.loginId, credentials.password(), options, this.transport ?? undefined);
  }
}
