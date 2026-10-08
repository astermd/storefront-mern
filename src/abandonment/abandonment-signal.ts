import { JourneyState } from '../journey/journey-state';
import { AbandonmentStateValue } from './abandonment-state';

/**
 * Ported from storefront-lamp/core/Abandonment/AbandonmentSignal.php. One abandonment signal:
 * everything `[21.11]` says the consuming email automation is owed about a journey that stopped,
 * and deliberately nothing else.
 *
 * **What is not here is the point.** `[20.6]` puts clinical answers outside every log, exception
 * message and analytics payload, and a polled JSON document handed to an outside platform is the
 * widest of the three. So this carries the *fact* of an abandoned journey and never its content: no
 * answers, no cart lines, no buyer name, no email address. `opportunityId` is a join to a record the
 * EMR already has, not anything the visitor typed.
 *
 * **The resume link, and the permanent exposure it carries.** This deployment's resume parameter is
 * the raw session uuid — it carries no expiry, and completing a journey does not revoke it. That is
 * a deliberate choice, not an omission (see `config/abandonment.ts`); the compensating control is
 * the audit trail `AbandonmentSweep` writes on every emitted signal (`[30.7]`).
 */
export class AbandonmentSignal {
  /** The visitor ticked the marketing consent when they were shown it (`[26.2]`). */
  static readonly MARKETING_GRANTED = 'granted';
  /** The visitor was shown the marketing consent and did not tick it — `[21.11b]`'s mark. */
  static readonly MARKETING_DECLINED = 'declined';
  /** The journey stopped before the consent controls were ever rendered. */
  static readonly MARKETING_NOT_ASKED = 'not_asked';

  constructor(
    public readonly state: AbandonmentStateValue,
    public readonly sessionUuid: string,
    public readonly opportunityId: string | null,
    /** The funnel's own recording (`[21.7]`), or null when the journey never completed a step. */
    public readonly furthestStep: string | null,
    public readonly resumeUrl: string,
    public readonly marketingConsent: string,
    /** `sessions.updatedAt`, which advances only when journey state actually changed. */
    public readonly lastMovedAt: string,
    public readonly idleSeconds: number,
  ) {}

  /**
   * How this journey answered the marketing consent, as one of the three values above.
   *
   * **Three values rather than a boolean, and no derived "suppress" flag.** Consents are written
   * in one place, at checkout submission, so most abandoned journeys never reached the question at
   * all. Folding that into `declined` would say the visitor refused something nobody asked them,
   * and folding it into `granted` would be worse. The fact is reported; the branch belongs to the
   * consumer.
   */
  static marketingConsentOf(state: JourneyState, key: string): string {
    for (const consent of state.consents) {
      if (consent.key === key) {
        return consent.granted ? AbandonmentSignal.MARKETING_GRANTED : AbandonmentSignal.MARKETING_DECLINED;
      }
    }

    return AbandonmentSignal.MARKETING_NOT_ASKED;
  }

  /**
   * A stable identity for "this journey, in this state, having last moved at this moment" —
   * `[21.13]`'s answer for a polled feed. Composed and readable rather than hashed: every part of
   * it is already elsewhere in the same document.
   */
  signalKey(): string {
    return `${this.sessionUuid}:${this.state}:${this.lastMovedAt}`;
  }

  /** The wire document — a contract with an external system (`[21.11a]`), not an internal detail. */
  toArray(): Record<string, unknown> {
    return {
      signal_key: this.signalKey(),
      state: this.state,
      session_uuid: this.sessionUuid,
      opportunity_id: this.opportunityId,
      furthest_step: this.furthestStep,
      resume_url: this.resumeUrl,
      marketing_consent: this.marketingConsent,
      last_moved_at: this.lastMovedAt,
      idle_seconds: this.idleSeconds,
    };
  }
}
