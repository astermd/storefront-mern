import { SessionGateway, SessionViewResult } from '../../src/emr/session-gateway';

/**
 * A test-only `SessionGateway` that actually mints a session, unlike `NullSessionGateway` (which
 * `create()` always answers null under, so no journey ever persists across requests — see
 * `SessionResolver`'s doc comment). Needed by any e2e test that must survive a redirect chain with
 * durable `JourneyState` (order placement, the upsell queue, completion) rather than exercising only
 * what still works with no session at all.
 */
export class FakeSessionGateway implements SessionGateway {
  private counter = 0;

  constructor(private readonly mintUuid?: string) {}

  async create(_data: Record<string, unknown>, _userAgent: string | null, _clientIp: string | null): Promise<string | null> {
    this.counter += 1;
    return this.mintUuid ?? `00000000-0000-4000-8000-${String(this.counter).padStart(12, '0')}`;
  }

  async view(_uuid: string): Promise<SessionViewResult | null> {
    return { exists: true, opportunityId: null, events: [] };
  }
}
