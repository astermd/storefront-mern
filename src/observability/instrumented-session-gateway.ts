import { SessionGateway, SessionViewResult } from '../emr/session-gateway';
import { Boundary } from './boundary';
import { BoundaryTimer } from './boundary-timer';

/**
 * Ported from storefront-lamp/core/Observability/InstrumentedSessionGateway.php. `[20.9]` over the
 * analytics-session boundary.
 *
 * A session that cannot be minted is not an error anywhere in this application — it degrades to "no
 * session" (`[4.5]`, `[20.1]`) — which is exactly why the outcome has to be counted here. Without
 * it, an EMR that has stopped minting sessions looks identical to a quiet afternoon.
 */
export class InstrumentedSessionGateway implements SessionGateway {
  constructor(
    private readonly inner: SessionGateway,
    private readonly timer: BoundaryTimer,
  ) {}

  async create(data: Record<string, unknown>, userAgent: string | null, clientIp: string | null): Promise<string | null> {
    return this.timer.measure(
      Boundary.EmrSession,
      () => this.inner.create(data, userAgent, clientIp),
      (uuid) => ({ outcome: uuid === null ? 'failed' : 'created' }),
      { operation: 'create' },
    );
  }

  async view(uuid: string): Promise<SessionViewResult | null> {
    return this.timer.measure(
      Boundary.EmrSession,
      () => this.inner.view(uuid),
      (view) => ({ outcome: view === null ? 'failed' : 'ok' }),
      { operation: 'view', session: uuid },
    );
  }
}
