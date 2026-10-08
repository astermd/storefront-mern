import { Injectable } from '@nestjs/common';
import { IntakeConfig } from '../../config/intake';
import { OperatorLog } from '../support/operator-log';
import { AnswerSet } from './answer-set';
import { Definition } from './definition';
import { DisqualificationOutcome } from './disqualification-outcome';
import { Field } from './field';
import { RuleEvaluator } from './rule-evaluator';
import { TerminationRule } from './termination-rule';

/** The alert types that carry a rule, mapped onto the mode each one means. */
const ALERT_MODES: Record<string, string> = {
  danger: TerminationRule.MODE_HARD,
  warning: TerminationRule.MODE_ADVISORY,
};

/**
 * Operators that compare an answer against an authored value from the field's own option list, and
 * so can be checked for a comparand no option can ever produce.
 */
const COMPARAND_OPERATORS = ['equals', 'not_equals', 'contains', 'not_contains', 'in', 'not_in', 'notEquals', 'notContains', 'notIn', ''];

/**
 * Ported from storefront-lamp/core/Forms/Disqualification.php. Reads a form's disqualification
 * rules and says whether a set of answers may proceed.
 *
 * Real forms do not declare a "termination rules" block; what authors actually write is an
 * **alert field revealed by a condition**: the alert's own `conditions` are the rule,
 * `properties.alertText` is the message, and `properties.alertType` is the mode — `danger` ends
 * the journey, `warning` flags the answer for clinician review and lets it continue (`[10.43]`).
 *
 * The division of labour is `[10.44a]`'s: this class says *whether* a journey may proceed and
 * names the rule that decided it. It does not stop anything — the funnel is what refuses the next
 * step.
 */
@Injectable()
export class Disqualification {
  /** Comparand warnings already written, so a form whose every rule is mis-authored still produces one line per defect. */
  private readonly reportedUnmatchable = new Set<string>();

  /** Teleforms already reported as falling back to configured rules. */
  private readonly reportedFallback = new Set<string>();

  constructor(
    private readonly evaluator: RuleEvaluator,
    private readonly config: IntakeConfig,
    private readonly log: OperatorLog,
  ) {}

  /**
   * The rules governing one teleform, definition first.
   *
   * Configured rules are a fallback for a form that declares none, never a supplement: merging the
   * two would let a stale config entry keep disqualifying people after the form author removed the
   * question it reads.
   */
  rulesFor(teleformId: string, definition: Definition): TerminationRule[] {
    let rules: TerminationRule[] = [];
    for (const field of definition.fields()) {
      const rule = Disqualification.ruleFromAlert(field);
      if (rule !== null) rules.push(rule);
    }

    if (rules.length === 0) {
      rules = this.configuredRules(teleformId);
    }

    this.reportUnmatchableComparands(rules, definition);

    return rules;
  }

  /**
   * Evaluates every rule against the answers given so far.
   *
   * Hard stops are checked first and the first match wins, so an advisory authored earlier in the
   * form can never mask a hard stop authored later. Advisories are collected either way.
   */
  evaluate(teleformId: string, definition: Definition, answers: AnswerSet): DisqualificationOutcome {
    const rules = this.rulesFor(teleformId, definition);
    const values = answers.all();

    let hard: TerminationRule | null = null;
    for (const rule of rules) {
      if (rule.isHard() && this.matches(rule, values, definition)) {
        hard = rule;
        break;
      }
    }

    const advisories: TerminationRule[] = [];
    for (const rule of rules) {
      if (!rule.isHard() && this.matches(rule, values, definition)) {
        advisories.push(rule);
      }
    }

    return hard === null ? DisqualificationOutcome.clear(advisories) : DisqualificationOutcome.stop(hard, advisories);
  }

  /** A rule fires when **any** of its conditions is satisfied. */
  private matches(rule: TerminationRule, values: Record<string, unknown>, definition: Definition): boolean {
    for (const condition of rule.conditions) {
      if (this.evaluator.group(condition, values, definition)) return true;
    }
    return false;
  }

  /**
   * Turns one field into a rule, or `null` if it is not one.
   *
   * Only `show` conditions are kept. A `hide` condition on an alert is presentation — honouring it
   * as a disqualifier would fire a hard stop on the answers that were meant to put the notice away.
   */
  private static ruleFromAlert(field: Field): TerminationRule | null {
    if (field.type !== 'alert') return null;

    const mode = ALERT_MODES[String(field.properties.alertType ?? '').toLowerCase().trim()];
    if (mode === undefined) return null;

    const conditions = field.conditions.filter((c) => String(c.action ?? '') === 'show');
    if (conditions.length === 0) return null;

    const message = String(field.properties.alertText ?? '').trim();

    return new TerminationRule(
      field.id,
      mode,
      // The label is the fallback because an alert whose text lives in its label still has
      // something to show the visitor.
      message !== '' ? message : field.label,
      conditions,
    );
  }

  /**
   * The configured fallback for a form that authors no rules of its own.
   *
   * `rules` is required: an entry with nothing to test would be a rule that either never fires or
   * always does. `mode` defaults to `hard`, and anything other than `advisory` is read as `hard`.
   */
  private configuredRules(teleformId: string): TerminationRule[] {
    const configured = this.config.disqualification[teleformId];
    if (!Array.isArray(configured)) return [];

    const rules: TerminationRule[] = [];
    configured.forEach((entry, index) => {
      const conditionRules = Array.isArray(entry.rules) ? entry.rules.filter((r) => r !== null && typeof r === 'object') : [];
      if (conditionRules.length === 0) return;

      const id = String(entry.id ?? '').trim();
      const mode = String(entry.mode ?? TerminationRule.MODE_HARD).trim();

      rules.push(
        new TerminationRule(
          id !== '' ? id : `configured_${index + 1}`,
          mode === TerminationRule.MODE_ADVISORY ? TerminationRule.MODE_ADVISORY : TerminationRule.MODE_HARD,
          String(entry.message ?? ''),
          [{ action: 'show', logic: entry.logic ?? 'and', rules: conditionRules }],
        ),
      );
    });

    if (rules.length > 0 && !this.reportedFallback.has(teleformId)) {
      this.reportedFallback.add(teleformId);
      this.log.info('intake.disqualification_from_config', { teleform_id: teleformId, rules: rules.length });
    }

    return rules;
  }

  /**
   * Warns about a rule that compares a choice field against a value none of its options can
   * produce. Only equality-family operators against a field that declares options are checkable.
   * The line names the rule, the field and the operator and **never the comparand**.
   */
  private reportUnmatchableComparands(rules: TerminationRule[], definition: Definition): void {
    for (const rule of rules) {
      for (const condition of rule.conditions) {
        for (const conditionRule of Array.isArray(condition.rules) ? condition.rules : []) {
          if (conditionRule && typeof conditionRule === 'object') {
            this.checkComparand(rule, conditionRule as Record<string, unknown>, definition);
          }
        }
      }
    }
  }

  private checkComparand(rule: TerminationRule, conditionRule: Record<string, unknown>, definition: Definition): void {
    const operator = String(conditionRule.operator ?? '').trim();
    if (!COMPARAND_OPERATORS.includes(operator)) return;

    const field = definition.field(String(conditionRule.field ?? ''));
    if (field === null) return;

    const options = field.options();
    if (options.length === 0) return;

    const comparands = Disqualification.comparands(conditionRule.value);
    if (comparands.length === 0) return;

    const values = options.map((option) => option.value);
    if (comparands.some((comparand) => values.includes(comparand))) return;

    const key = `${rule.id}|${field.name}|${operator}`;
    if (this.reportedUnmatchable.has(key)) return;

    this.reportedUnmatchable.add(key);
    this.log.warning('intake.termination_rule_unmatchable', {
      rule: rule.id,
      field: field.name,
      operator: operator === '' ? 'equals' : operator,
    });
  }

  /** The values one condition rule compares against, as the evaluator reads them. */
  private static comparands(value: unknown): string[] {
    let comparands: string[];
    if (Array.isArray(value)) {
      comparands = value.map((entry) => (Disqualification.isScalar(entry) ? String(entry).trim() : ''));
    } else if (typeof value === 'string') {
      comparands = value.split(',').map((part) => part.trim());
    } else if (Disqualification.isScalar(value)) {
      comparands = [String(value).trim()];
    } else {
      return [];
    }

    return comparands.filter((entry) => entry !== '');
  }

  private static isScalar(value: unknown): boolean {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
  }
}
