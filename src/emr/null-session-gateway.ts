import { Injectable } from '@nestjs/common';
import { SessionGateway, SessionViewResult } from './session-gateway';

/**
 * Ported from storefront-lamp/core/Emr/NullSessionGateway.php. The gateway used when EMR
 * analytics sessions are switched off — `config.app.session.analytics` false, which `NODE_ENV=
 * test` always forces regardless of anything else, so the test suite never reaches the network.
 * Outside tests, `EmrSessionGateway` (backed by `@astermd-hq/sdk`) is bound instead — see
 * `core/core.module.ts`.
 *
 * Reports "no session could be created" and "this session is not known", which are states the
 * funnel already has to handle (`[4.5]`), so switching analytics off degrades the storefront
 * rather than changing its behaviour.
 */
@Injectable()
export class NullSessionGateway implements SessionGateway {
  async create(): Promise<string | null> {
    return null;
  }

  async view(): Promise<SessionViewResult | null> {
    return { exists: false, opportunityId: null, events: [] };
  }
}
