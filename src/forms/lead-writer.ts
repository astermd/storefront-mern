import { Inject, Injectable } from '@nestjs/common';
import { LEAD_GATEWAY } from '../core/tokens';
import { JourneyState } from '../journey/journey-state';
import { OperatorLog } from '../support/operator-log';
import { LeadGateway } from './lead-gateway';
import { LeadOutcome } from './lead-outcome';
import { RecordMapper } from './record-mapper';

/**
 * Ported from storefront-lamp/core/Forms/LeadWriter.php. Create-once-then-update orchestration for
 * the lead behind an intake form (`[9.7]`), and the single place a failed lead write is swallowed.
 *
 * **Why the swallow lives here and not at the call sites.** A visitor filling in a medical form
 * must never see a CRM outage, and must never be blocked by one (`[10.26]`).
 *
 * **The threshold guards creation only.** `[9.9]` is a correctness rule, not a failure policy:
 * below a first name and an email the record is a fragment nobody can follow up on, so the gateway
 * is not called at all. Once an opportunity exists, every later save is an update regardless of
 * what it carries.
 *
 * **A failed create leaves the journey able to retry.** `opportunityId` stays null, so the next
 * capture attempts the create again (`[9.5]`). The converse rule holds too: an id, once
 * remembered, is never unset.
 *
 * **The log carries key names, never values.**
 */
@Injectable()
export class LeadWriter {
  constructor(
    @Inject(LEAD_GATEWAY) private readonly gateway: LeadGateway,
    private readonly mapper: RecordMapper,
    private readonly log: OperatorLog,
  ) {}

  /**
   * Writes what is known about this visitor to their lead, creating it if the payload has finally
   * crossed the threshold.
   *
   * @param payload the `opportunity`-rooted record, rebuilt in full (`[11.5]`)
   */
  async capture(sessionUuid: string, state: JourneyState, payload: Record<string, unknown>): Promise<LeadOutcome> {
    // Nothing answered yet maps to nothing worth saying — and an empty update would be a round
    // trip that changes no field.
    if (Object.keys(payload).length === 0) {
      return LeadOutcome.noneCreated(state.opportunityId);
    }

    // A gateway that writes nowhere has not failed, so nothing is logged.
    if (!this.gateway.writes()) {
      return LeadOutcome.noneCreated(state.opportunityId);
    }

    const existing = state.opportunityId;

    if (existing !== null) {
      const updated = await this.gateway.update(existing, payload);
      if (!updated) {
        this.log.warning('intake.lead_write_failed', {
          session: sessionUuid,
          operation: 'update',
          opportunity_id: existing,
          fields: Object.keys(payload),
        });
      }
      return LeadOutcome.noneCreated(existing);
    }

    if (!this.mapper.ready(payload)) {
      return LeadOutcome.noneCreated();
    }

    const opportunityId = await this.gateway.create(this.creationPayload(sessionUuid, state, payload));

    if (opportunityId === null) {
      this.log.warning('intake.lead_write_failed', {
        session: sessionUuid,
        operation: 'create',
        fields: Object.keys(payload),
      });
      return LeadOutcome.noneCreated();
    }

    state.opportunityId = opportunityId;
    return LeadOutcome.createdLead(opportunityId);
  }

  /**
   * The record as the create call receives it: the mapped answers, the analytics session that
   * produced them, and the first-touch source.
   *
   * The source is attached on creation only (`[11.9]`, `[5.12]`): attribution is captured once on
   * first touch, so re-sending it on later updates could only overwrite the first answer with a
   * later one.
   */
  private creationPayload(sessionUuid: string, state: JourneyState, payload: Record<string, unknown>): Record<string, unknown> {
    // Union rather than assignment: a mapping that already resolved `sessions` was authored
    // deliberately and is not ours to replace.
    const withSessions = payload.sessions !== undefined ? payload : { ...payload, sessions: [sessionUuid] };

    const source = state.attribution?.derived.sourceCategory ?? null;
    if (withSessions.source === undefined && typeof source === 'string' && source.trim() !== '') {
      return { ...withSessions, source };
    }

    return withSessions;
  }
}
