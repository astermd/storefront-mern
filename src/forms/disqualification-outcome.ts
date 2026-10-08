import { TerminationRule } from './termination-rule';

/**
 * Ported from storefront-lamp/core/Forms/DisqualificationOutcome.php. What the disqualification
 * rules said about one set of answers.
 *
 * A hard stop is at most one rule — the first that matched — because the visitor is shown a single
 * reason and the journey records a single rule id (`[10.44]`). Advisories are a list and are
 * reported *whether or not* a hard stop fired: a clinician reviewing a terminated journey still
 * wants the flags that were raised along the way.
 *
 * The outcome deliberately carries no verb. It says whether a journey may proceed; redirecting,
 * recording and rendering the reason belong to the funnel and the controller (`[10.44a]`).
 */
export class DisqualificationOutcome {
  private constructor(
    private readonly hard: TerminationRule | null,
    private readonly advisoriesList: TerminationRule[],
  ) {}

  /** No hard stop matched: the journey may proceed, carrying whatever advisories were raised on the way. */
  static clear(advisories: TerminationRule[] = []): DisqualificationOutcome {
    return new DisqualificationOutcome(null, advisories);
  }

  static stop(rule: TerminationRule, advisories: TerminationRule[] = []): DisqualificationOutcome {
    return new DisqualificationOutcome(rule, advisories);
  }

  isHard(): boolean {
    return this.hard !== null;
  }

  /** The matched hard rule's id, which is what the journey stores so a resumed session stays terminated (`[10.44]`). */
  ruleId(): string | null {
    return this.hard?.id ?? null;
  }

  /** The authored message for the matched rule — the visitor's reason, never a generic one (`[10.42]`). */
  message(): string | null {
    return this.hard?.message ?? null;
  }

  advisories(): TerminationRule[] {
    return this.advisoriesList;
  }
}
