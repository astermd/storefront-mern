import { API, ClientOptions, HttpClientInterface } from '@astermd-hq/vrio-client';
import { VrioCredentials } from './vrio-credentials';

/**
 * Ported from storefront-lamp/core/Payment/Vrio/VrioApiFactory.php. A fresh client is built per
 * call (never cached), matching the PHP original — cheap, since it's just wiring credentials
 * and a transport onto `@astermd-hq/vrio-client`'s own `API`.
 *
 * The package's own debug logging is deliberately never turned on here; wire logging (when
 * enabled) is a separate decorator around whichever transport this factory is given — see
 * `VrioWireLog`.
 */
export class VrioApiFactory {
  constructor(private readonly transport: HttpClientInterface | null = null) {}

  create(credentials: VrioCredentials): API {
    const options: ClientOptions = { host: credentials.host, timeout: 30, connectTimeout: 10 };
    if (credentials.basePath !== '') {
      options.basePath = credentials.basePath;
    }

    return new API(credentials.apiKey(), options, this.transport ?? undefined);
  }
}
