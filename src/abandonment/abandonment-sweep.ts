import { Injectable, Optional } from '@nestjs/common';
import { JourneyState } from '../journey/journey-state';
import { EventRepository } from '../repository/event-repository';
import { SessionRepository } from '../repository/session-repository';
import { ConfigService } from '../support/config';
import { AbandonmentClassifier } from './abandonment-classifier';
import { AbandonmentSignal } from './abandonment-signal';

/** `[30.7]`'s name for a journey serialised into a signal that left the storefront. */
const ACCESS_EVENT = 'access.abandonment_signal';

/**
 * Ported from storefront-lamp/core/Abandonment/AbandonmentSweep.php. The time half of `[21.10]`:
 * which journeys have stopped moving, and what state each of them stopped in.
 *
 * **Server-side and time-based, and there was never a choice about that.** `[21.12]` forbids
 * depending on a browser unload event, and this deployment has no client-side session bridge — the
 * HTTP-only `amd_session` cookie is the only carrier a browser holds.
 *
 * **`sessions.updatedAt` is a genuine "last moved" timestamp**, not "last seen", because
 * `JourneyStore.flush()` compares a fingerprint of the durable state and writes nothing when it has
 * not changed. A visitor who reloads the checkout page ten times does not reset their own
 * abandonment clock; one who adds a line to their cart does.
 *
 * **Polling, not push (`[21.11a]`).** This deployment has no outbound push infrastructure and no
 * inbound authentication to build one behind, so the signals are exposed for an external system to
 * collect — `AbandonmentCommand` is that exposure. It follows that this class **changes nothing it
 * reads**: a sweep that marked rows as it read them would lose a signal permanently whenever a poll
 * failed midway. Deduplication is the consumer's, on `AbandonmentSignal.signalKey()`.
 *
 * **The one thing it does write is the `[30.7]` access row**, and that is append-only, so it cannot
 * change which journeys the next sweep returns, and `EventRepository.append()` swallows its own
 * failures, so it cannot disturb the storefront either (`[18.3]`, `[20.1]`). It has to exist because
 * every signal carries a resume link with no expiry and no revocation, and is therefore a credential
 * for somebody's intake answers leaving the storefront.
 */
@Injectable()
export class AbandonmentSweep {
  private readonly classifier = new AbandonmentClassifier();
  private readonly clock: () => number;

  constructor(
    private readonly sessions: SessionRepository,
    private readonly events: EventRepository,
    private readonly config: ConfigService,
    @Optional() clock?: () => number,
  ) {
    this.clock = clock ?? (() => Math.floor(Date.now() / 1000));
  }

  /**
   * The abandonment signals as they stand right now, longest-idle first.
   *
   * A row that classifies as nothing contributes nothing: the window catches every session that has
   * stopped moving, including ones that never took a step worth abandoning, and emitting a null
   * state for those would make the automation filter out most of what it polls.
   */
  async signals(): Promise<AbandonmentSignal[]> {
    const { idleSeconds, lookbackSeconds, limit, marketingConsentKey } = this.config.abandonment;
    const now = this.clock();

    const rows = await this.sessions.findLastMovedBetween(
      new Date((now - lookbackSeconds) * 1000).toISOString(),
      new Date((now - idleSeconds) * 1000).toISOString(),
      limit,
    );

    const signals: AbandonmentSignal[] = [];

    for (const row of rows) {
      const state = JourneyState.fromArray(row.journeyState, row.attribution, row.opportunityId);
      const classified = this.classifier.classify(state);

      if (classified === null) {
        continue;
      }

      const lastMovedAt = row.updatedAt;
      const movedAtTimestamp = Date.parse(lastMovedAt);

      signals.push(
        new AbandonmentSignal(
          classified,
          row.sessionUuid,
          state.opportunityId,
          state.furthestStep,
          this.resumeUrl(row.sessionUuid),
          AbandonmentSignal.marketingConsentOf(state, marketingConsentKey),
          lastMovedAt,
          Number.isNaN(movedAtTimestamp) ? 0 : Math.max(0, now - Math.floor(movedAtTimestamp / 1000)),
        ),
      );

      await this.auditAccess(row.sessionUuid, classified);
    }

    return signals;
  }

  /**
   * `[30.7]`: this journey was read and a signal carrying its resume link is about to leave.
   * Recorded for the rows that produced a signal, not for every row the window returned.
   */
  private async auditAccess(sessionUuid: string, state: string): Promise<void> {
    await this.events.append(sessionUuid, ACCESS_EVENT, {
      actor: 'abandonment_sweep',
      reason: 'abandonment_signal',
      state,
      resume_link: true,
    });
  }

  /**
   * The link that puts this visitor back where they were (`[21.11]`) — the site root rather than
   * the step they stopped on, since the resume parameter is read on every request and the funnel
   * guard then routes them to wherever their own journey says they belong.
   */
  private resumeUrl(sessionUuid: string): string {
    const query = new URLSearchParams({ [this.config.app.session.resumeParam]: sessionUuid }).toString();
    return `${this.config.app.url.replace(/\/+$/, '')}/?${query}`;
  }
}
