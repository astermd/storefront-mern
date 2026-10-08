/**
 * Ported from storefront-lamp/core/Forms/TerminationRule.php. One disqualification rule: the three
 * things `[10.42]` requires a rule to declare — a condition, a message and a mode — held together
 * as a value.
 *
 * Modes are two rather than a boolean because the difference is clinical, not technical. A `hard`
 * rule ends the journey; an `advisory` one records that a clinician has to look at this answer and
 * lets the visitor carry on, so the two must never collapse into "disqualified" (`[10.42]`,
 * `[10.43]`).
 *
 * `conditions` stays in the raw authored shape rather than being parsed into something of its own,
 * because `RuleEvaluator.group()` is the only thing that ever reads it and it is the same evaluator
 * that resolves field state — one set of combinator and operator semantics governs both. More than
 * one condition means any of them firing is enough: each is an independent way the authored alert
 * becomes visible.
 */
export class TerminationRule {
  static readonly MODE_HARD = 'hard';
  static readonly MODE_ADVISORY = 'advisory';

  constructor(
    public readonly id: string,
    public readonly mode: string,
    public readonly message: string,
    /** Condition groups in authored shape, any one of which fires the rule. */
    public readonly conditions: Record<string, unknown>[],
  ) {}

  isHard(): boolean {
    return this.mode === TerminationRule.MODE_HARD;
  }
}
