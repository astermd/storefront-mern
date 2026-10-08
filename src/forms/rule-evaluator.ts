import { Injectable, Optional } from '@nestjs/common';
import { Definition } from './definition';
import { Field } from './field';
import { FieldState } from './field-state';
import { OperatorLog } from '../support/operator-log';

/** camelCase spellings the authoring UI emits, mapped onto the canonical snake_case set. */
const OPERATOR_ALIASES: Record<string, string> = {
  notEquals: 'not_equals',
  notContains: 'not_contains',
  isEmpty: 'is_empty',
  isNotEmpty: 'is_not_empty',
  notIn: 'not_in',
};

/** Actions that change a field's state. Everything else is presentation and is ignored server-side. */
const HONOURED_ACTIONS = ['show', 'hide', 'enable', 'disable', 'require', 'make_required', 'optional', 'make_optional'];

/**
 * Ported from storefront-lamp/core/Forms/RuleEvaluator.php. Evaluates a definition's conditional
 * logic: one rule, a group of rules, and the resolved state of a field.
 *
 * Pure by design — answers in, booleans out, no I/O — because this is the only gate the storefront
 * actually trusts. The hosted engine renders one of two modes and this class renders the other, and
 * `[28.3]` requires the two to mean the same thing, so every semantic here is copied from the
 * engine rather than chosen: a missing operator means `equals`, an operator nobody recognises
 * evaluates **false** instead of throwing (`[10.18]`), and comparisons against a list-valued answer
 * are membership tests rather than string comparisons.
 *
 * Two places where the engine differs from the spec's prose, and the engine wins because the engine
 * is what one of the modes runs:
 *
 * - A `logic` array carries one combinator **per join**, so `logic[i-1]` is what joins the
 *   accumulated result with rule `i` and the array is one shorter than the rule list.
 * - Conditions default **inverted**: a field carrying a `show` condition starts invisible and a
 *   field carrying an `enable` condition starts disabled, so an authored `show` reveals rather than
 *   merely confirming.
 *
 * Numeric comparison is load-bearing rather than optional (`[10.41c]`): a real weight-loss form
 * hard-stops on `bmi_measurement less_than '27'`, a threshold over a computed value, so both sides
 * of every ordering comparison run through the same coercion helper and dates compare
 * chronologically.
 */
@Injectable()
export class RuleEvaluator {
  /** Action names already reported, so a form that repeats a presentation-only action on forty fields still produces one log line per distinct action. */
  private readonly reportedActions = new Set<string>();

  constructor(@Optional() private readonly log: OperatorLog | null = null) {}

  /**
   * Evaluates one rule against the answers.
   *
   * `subject` is the field the rule **reads** — resolved by the caller from `rule.field` — needed
   * for two things. A `phone` field is normalised on both sides, so a formatted answer still
   * matches an unformatted comparand. And a `null` subject means the definition does not declare
   * that field at all, which evaluates false even when an answer exists under the name.
   */
  rule(rule: Record<string, unknown>, answers: Record<string, unknown>, subject: Field | null): boolean {
    if (subject === null) return false;

    const operator = RuleEvaluator.canonicalOperator(rule.operator);
    const answer = answers[String(rule.field ?? '')] ?? null;

    if (operator === 'is_empty') return RuleEvaluator.isEmpty(answer);
    if (operator === 'is_not_empty') return !RuleEvaluator.isEmpty(answer);

    const value = rule.value ?? null;
    const phone = subject.type === 'phone';

    if (Array.isArray(answer)) {
      return RuleEvaluator.listRule(operator, RuleEvaluator.valueList(answer, phone), RuleEvaluator.valueList(value, phone));
    }

    return RuleEvaluator.scalarRule(operator, answer, value, phone);
  }

  /**
   * Evaluates a whole condition group: its rules joined by its combinators.
   *
   * An empty rule list is **not** satisfied. A condition with nothing to test is an authoring
   * accident, and treating it as vacuously true would fire every `show` and every hard stop that
   * carried one.
   */
  group(condition: Record<string, unknown>, answers: Record<string, unknown>, definition: Definition): boolean {
    const rules = (Array.isArray(condition.rules) ? condition.rules : []).filter(
      (r): r is Record<string, unknown> => r !== null && typeof r === 'object',
    );
    if (rules.length === 0) return false;

    const logic = condition.logic ?? null;
    let result = this.evaluate(rules[0], answers, definition);

    for (let i = 1; i < rules.length; i++) {
      const combinator = Array.isArray(logic)
        ? String(logic[i - 1] ?? 'and').toLowerCase().trim()
        : String(logic ?? '').toLowerCase().trim();

      result = combinator === 'or' ? result || this.evaluate(rules[i], answers, definition) : result && this.evaluate(rules[i], answers, definition);
    }

    return result;
  }

  /**
   * Resolves one field's visibility, disabled and required flags for a given set of answers.
   *
   * The authored flags are the starting point, then the engine's inverted defaults apply — see the
   * class docblock — and only then are the conditions walked in authored order, each honoured
   * action applied on match. Order matters: the last condition to match a field wins, which is how
   * an author layers a broad `show` under a narrower `hide`.
   *
   * A field that ends up invisible or disabled is forced non-required, so neither the browser nor
   * the validator can block a submission on a control the visitor cannot reach (`[10.19]`,
   * `[10.39]`).
   */
  state(field: Field, answers: Record<string, unknown>, definition: Definition): FieldState {
    let visible = !field.hidden;
    let disabled = field.disabled;
    let required = field.required;

    for (const condition of field.conditions) {
      const action = RuleEvaluator.action(condition);

      if (action === 'show') {
        visible = false;
      } else if (action === 'enable') {
        disabled = true;
      } else if (!HONOURED_ACTIONS.includes(action)) {
        this.reportUnsupportedAction(action);
      }
    }

    for (const condition of field.conditions) {
      const action = RuleEvaluator.action(condition);
      if (!HONOURED_ACTIONS.includes(action)) continue;
      if (!this.group(condition, answers, definition)) continue;

      switch (action) {
        case 'show':
          visible = true;
          break;
        case 'hide':
          visible = false;
          break;
        case 'enable':
          disabled = false;
          break;
        case 'disable':
          disabled = true;
          break;
        case 'require':
        case 'make_required':
          required = true;
          break;
        case 'optional':
        case 'make_optional':
          required = false;
          break;
      }
    }

    if (!visible || disabled) {
      required = false;
    }

    return new FieldState(visible, disabled, required);
  }

  private evaluate(rule: Record<string, unknown>, answers: Record<string, unknown>, definition: Definition): boolean {
    return this.rule(rule, answers, definition.field(String(rule.field ?? '')));
  }

  /**
   * The presentation-only actions — `apply_class_name`, `set_value`, `show_modal` and friends — are
   * deliberately ignored rather than implemented, but silence would make a form that relies on one
   * look as if it had simply not fired. One line per distinct action is enough for an operator to
   * notice; no answer is ever named.
   */
  private reportUnsupportedAction(action: string): void {
    if (this.log === null || action === '' || this.reportedActions.has(action)) return;

    this.reportedActions.add(action);
    this.log.info('intake.unsupported_action', { action });
  }

  private static action(condition: Record<string, unknown>): string {
    return String(condition.action ?? '');
  }

  /** An absent operator means `equals`, which is what the authoring UI omits when the author never changed it. */
  private static canonicalOperator(operator: unknown): string {
    if (typeof operator !== 'string' || operator.trim() === '') return 'equals';

    const trimmed = operator.trim();
    return OPERATOR_ALIASES[trimmed] ?? trimmed;
  }

  /**
   * Membership semantics for a list-valued answer, and the reason `contains 'None of the above'` is
   * false against `['none-of-the-above']`: the comparison is against stored option values, not
   * rendered labels.
   *
   * Operators outside the six that mean membership are false rather than coerced.
   */
  private static listRule(operator: string, selected: string[], comparands: string[]): boolean {
    const matched = comparands.some((comparand) => selected.includes(comparand));

    switch (operator) {
      case 'equals':
      case 'contains':
      case 'in':
        return matched;
      case 'not_equals':
      case 'not_contains':
      case 'not_in':
        return !matched;
      default:
        return false;
    }
  }

  private static scalarRule(operator: string, answer: unknown, value: unknown, phone: boolean): boolean {
    const left = RuleEvaluator.text(answer, phone);
    const right = RuleEvaluator.text(value, phone);

    switch (operator) {
      case 'equals':
        return left === right;
      case 'not_equals':
        return left !== right;
      case 'contains':
        return left.includes(right);
      case 'not_contains':
        return !left.includes(right);
      case 'in':
        return RuleEvaluator.valueList(value, phone).includes(left);
      case 'not_in':
        return !RuleEvaluator.valueList(value, phone).includes(left);
    }

    const a = RuleEvaluator.numeric(answer);
    const b = RuleEvaluator.numeric(value);
    if (a === null || b === null) return false;

    switch (operator) {
      case 'greater_than':
        return a > b;
      case 'greater_than_or_equal':
        return a >= b;
      case 'less_than':
        return a < b;
      case 'less_than_or_equal':
        return a <= b;
      default:
        return false;
    }
  }

  /** A `'0'` string is a real answer, so emptiness is about absence and whitespace only. */
  private static isEmpty(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    return false;
  }

  /**
   * The comparand list: an authored array as it stands, a string split on commas so `in`'s
   * "a, b, c" spelling works, and anything else as a single entry.
   */
  private static valueList(value: unknown, phone: boolean): string[] {
    if (Array.isArray(value)) {
      return value.map((entry) => RuleEvaluator.text(entry, phone));
    }
    if (typeof value === 'string') {
      return value.split(',').map((part) => RuleEvaluator.text(part.trim(), phone));
    }
    if (value === null || value === undefined) return [];
    return [RuleEvaluator.text(value, phone)];
  }

  /**
   * A comparable string. Booleans render as `true`/`false` rather than an empty string, because the
   * authoring UI writes conditions against what the engine's JavaScript would stringify.
   *
   * `phone` normalises both sides of a phone comparison down to digits and keeps the last ten, so a
   * country code or punctuation on one side only does not defeat the match.
   */
  private static text(value: unknown, phone: boolean): string {
    let text: string;
    if (value === null || value === undefined) {
      text = '';
    } else if (typeof value === 'boolean') {
      text = value ? 'true' : 'false';
    } else if (typeof value === 'string' || typeof value === 'number') {
      text = String(value);
    } else {
      text = '';
    }

    if (!phone) return text;

    const digits = text.replace(/\D+/g, '');
    return digits.length > 10 ? digits.slice(-10) : digits;
  }

  private static numeric(value: unknown): number | null {
    if (typeof value === 'number') {
      return Number.isNaN(value) ? null : value;
    }
    if (typeof value !== 'string') return null;

    const text = value.trim();
    if (text === '') return null;
    if (!Number.isNaN(Number(text)) && text !== '') return Number(text);

    // A date is a legitimate comparand -- `[10.41c]` allows a threshold over a derived value, and
    // a date of birth is the commonest one. Both sides go through this same helper.
    if (/[-/:Ta-zA-Z]/.test(text)) {
      const parsed = Date.parse(text);
      return Number.isNaN(parsed) ? null : parsed / 1000;
    }

    return null;
  }
}
