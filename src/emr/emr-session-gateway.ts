import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@astermd-hq/sdk';
import { OperatorLog } from '../support/operator-log';
import { EmrClientFactory } from './client-factory';
import { SessionGateway, SessionViewResult } from './session-gateway';

/**
 * Ported from storefront-lamp/core/Emr/EmrSessionGateway.php. {@link SessionGateway} over the
 * SDK's `sessions()` resource.
 *
 * Every call is wrapped: a transport error, a non-2xx envelope, or a missing identifier all
 * become `null` plus an operator log line, because a tracking outage that takes the storefront
 * down is a worse outage than the one it was reporting.
 *
 * The response readers probe several paths for the opportunity id and the event names, since
 * those key names are the EMR's to change and a shape variant should degrade to "not found"
 * rather than to a crash.
 */
@Injectable()
export class EmrSessionGateway implements SessionGateway {
  /**
   * Paths checked in order for the linked opportunity id, searched against the whole session
   * entry (so both `data.<path>` and a bare `<path>` are covered). The `data.`-prefixed variant
   * of each shape is tried first, since the SDK's docs describe the read-model as sitting under
   * `data`; the bare variant is the fallback for a flatter payload.
   */
  private static readonly OPPORTUNITY_PATHS = [
    'data.opportunity_id',
    'opportunity_id',
    'data.opportunity.id',
    'opportunity.id',
    'data.opportunity._id',
    'opportunity._id',
    'data.opportunity.opportunity_id',
    'opportunity.opportunity_id',
  ];

  /** Keys checked in order for an event's name inside the events timeline. */
  private static readonly EVENT_NAME_KEYS = ['event', 'name', 'type', 'event_name'];

  constructor(
    private readonly clients: EmrClientFactory,
    private readonly log: OperatorLog,
  ) {}

  async create(data: Record<string, unknown>, userAgent: string | null, clientIp: string | null): Promise<string | null> {
    try {
      const response = await this.clients.create().sessions().create({
        data,
        userAgent: userAgent ?? undefined,
        clientIp: clientIp ?? undefined,
      });
      const session = (response.data() as Record<string, unknown>)['session'];

      if (typeof session !== 'string' || session === '') {
        this.log.warning('session.create_failed', { reason: 'no session identifier in response' });
        return null;
      }

      return session;
    } catch (e) {
      this.log.warning('session.create_failed', { reason: e instanceof Error ? e.message : String(e) });
      return null;
    }
  }

  async view(uuid: string): Promise<SessionViewResult | null> {
    let data: Record<string, unknown>;
    try {
      const response = await this.clients.create().sessions().view({ sessions: [uuid] });
      data = response.data() as Record<string, unknown>;
    } catch (e) {
      if (e instanceof NotFoundError) {
        return { exists: false, opportunityId: null, events: [] };
      }
      this.log.warning('session.view_failed', { session: uuid, reason: e instanceof Error ? e.message : String(e) });
      return null;
    }

    const entry = data[uuid];
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { exists: false, opportunityId: null, events: [] };
    }
    const entryRecord = entry as Record<string, unknown>;

    const snapshot: SessionViewResult = {
      exists: true,
      opportunityId: EmrSessionGateway.opportunityId(entryRecord),
      events: EmrSessionGateway.eventNames(Array.isArray(entryRecord['events']) ? (entryRecord['events'] as unknown[]) : []),
    };

    // A session the EMR knows but whose read-model yielded neither an opportunity nor a single
    // event name is byte-identical to a genuinely fresh session — and is also exactly what an
    // extractor looking under the wrong key produces. Without this line the second case is
    // invisible. Info, not warning: for a session minted moments ago this is the correct answer.
    if (snapshot.opportunityId === null && snapshot.events.length === 0) {
      this.log.info('session.view_read_model_empty', { session: uuid });
    }

    return snapshot;
  }

  private static opportunityId(entry: Record<string, unknown>): string | null {
    for (const path of EmrSessionGateway.OPPORTUNITY_PATHS) {
      let value: unknown = entry;
      for (const segment of path.split('.')) {
        if (typeof value !== 'object' || value === null || Array.isArray(value) || !(segment in value)) {
          value = undefined;
          break;
        }
        value = (value as Record<string, unknown>)[segment];
      }

      if ((typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') && String(value) !== '') {
        return String(value);
      }
    }

    return null;
  }

  private static eventNames(events: unknown[]): string[] {
    const names: string[] = [];

    for (const event of events) {
      if (typeof event === 'string' || typeof event === 'number' || typeof event === 'boolean') {
        names.push(String(event));
        continue;
      }

      if (typeof event !== 'object' || event === null || Array.isArray(event)) {
        continue;
      }
      const eventRecord = event as Record<string, unknown>;

      for (const key of EmrSessionGateway.EVENT_NAME_KEYS) {
        const value = eventRecord[key];
        if (value !== undefined && value !== null && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) {
          names.push(String(value));
          break;
        }
      }
    }

    return Array.from(new Set(names));
  }
}
