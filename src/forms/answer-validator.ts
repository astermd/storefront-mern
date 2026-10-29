import { Injectable } from '@nestjs/common';
import { AnswerSet } from './answer-set';
import { Definition } from './definition';
import { Field } from './field';
import { FileRules } from './file-rules';
import { RuleEvaluator } from './rule-evaluator';

/** The shape the hosted engine accepts, kept deliberately loose. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Ported from storefront-lamp/core/Forms/AnswerValidator.php. Checks a set of answers against the
 * definition that asked for them, on the server, before anything is stored or forwarded.
 *
 * `[10.22]` is the hole this closes: validation used to live only in the browser, so the server
 * accepted whatever arrived. Everything the client checks is therefore re-checked here, and this is
 * the answer that counts.
 *
 * Visibility is **not** re-derived. It is read from `RuleEvaluator.state()`, the same resolution the
 * renderer draws from, so the two can never disagree about which controls were on screen — a
 * required question sitting on a branch the visitor's answers never revealed is not demanded.
 *
 * Two deliberate narrowings: a constraint is applied only when an answer is present, and undeclared
 * field names are not re-checked (`AnswerSet.merge()` already drops them at the boundary).
 */
@Injectable()
export class AnswerValidator {
  constructor(private readonly evaluator: RuleEvaluator) {}

  /**
   * Every field that failed, as field name => message, empty when valid.
   *
   * `pageIndex` is the step being advanced past, which validates that page alone (`[10.20]`).
   * `null` is a final submit and validates every page.
   */
  validate(definition: Definition, answers: AnswerSet, pageIndex: number | null = null): Record<string, string> {
    const values = answers.all();
    const errors: Record<string, string> = {};

    for (const field of AnswerValidator.fieldsUnderTest(definition, pageIndex)) {
      const message = this.check(field, values, definition);
      if (message !== null) {
        errors[field.name] = message;
      }
    }

    return errors;
  }

  /** The fields one call is answerable for, subfields included. */
  private static fieldsUnderTest(definition: Definition, pageIndex: number | null): Field[] {
    let pages = definition.pages();

    if (pageIndex !== null) {
      pages = pages[pageIndex] !== undefined ? [pages[pageIndex]] : [];
    }

    const fields: Field[] = [];
    for (const page of pages) {
      for (const field of page.fields) {
        fields.push(...AnswerValidator.withSubfields(field));
      }
    }

    return fields;
  }

  private static withSubfields(field: Field): Field[] {
    const fields = [field];
    for (const subfield of field.subfields) {
      fields.push(...AnswerValidator.withSubfields(subfield));
    }
    return fields;
  }

  private check(field: Field, values: Record<string, unknown>, definition: Definition): string | null {
    if (field.isDisplayOnly()) return null;

    const state = this.evaluator.state(field, values, definition);
    if (!state.visible || state.disabled) return null;

    const value = values[field.name] ?? null;

    if (state.required && !AnswerValidator.answered(field, value)) {
      return this.message(field, 'required', `${AnswerValidator.label(field)} is required.`);
    }

    if (!AnswerValidator.present(value)) return null;

    return this.constraintFailure(field, value);
  }

  /** Whether a required field has actually been answered. */
  private static answered(field: Field, value: unknown): boolean {
    if (field.isBoolean()) return value === true;
    if (field.isMultiValue() || field.isFileUpload()) return Array.isArray(value) && value.length > 0;
    return AnswerValidator.isScalar(value) && String(value).trim() !== '';
  }

  private static present(value: unknown): boolean {
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'boolean') return value;
    return AnswerValidator.isScalar(value) && String(value).trim() !== '';
  }

  private constraintFailure(field: Field, value: unknown): string | null {
    const validation = field.validation;
    const label = AnswerValidator.label(field);

    // A file question's only constraint is how many files it takes; the size and kind of each were
    // checked before it was uploaded, and the text constraints below would read a list of files as
    // an empty string.
    if (field.isFileUpload()) {
      const maxFiles = FileRules.for(field).maxFiles;

      return maxFiles !== null && Array.isArray(value) && value.length > maxFiles
        ? this.message(field, 'maxFiles', `${label} takes at most ${maxFiles} file${maxFiles === 1 ? '' : 's'}.`)
        : null;
    }

    if (field.isSignature()) return null;

    const text = AnswerValidator.isScalar(value) ? String(value) : '';
    const length = [...text].length;

    const minLength = AnswerValidator.integer(validation.minLength);
    if (minLength !== null && length < minLength) {
      return this.message(field, 'minLength', `${label} must be at least ${minLength} characters.`);
    }

    const maxLength = AnswerValidator.integer(validation.maxLength);
    if (maxLength !== null && length > maxLength) {
      return this.message(field, 'maxLength', `${label} must be ${maxLength} characters or fewer.`);
    }

    if (AnswerValidator.breaksPattern(validation.pattern, text)) {
      return this.message(field, 'pattern', `${label} is not in the expected format.`);
    }

    if (field.type === 'email' && !EMAIL_SHAPE.test(text)) {
      return this.message(field, 'pattern', `${label} must be a valid email address.`);
    }

    const trimmed = text.trim();
    const number = trimmed !== '' && !Number.isNaN(Number(trimmed)) ? Number(trimmed) : null;

    const min = AnswerValidator.number(validation.minValue);
    if (number !== null && min !== null && number < min) {
      return this.message(field, 'min', `${label} must be ${AnswerValidator.plain(min)} or more.`);
    }

    const max = AnswerValidator.number(validation.maxValue);
    if (number !== null && max !== null && number > max) {
      return this.message(field, 'max', `${label} must be ${AnswerValidator.plain(max)} or less.`);
    }

    const minItems = AnswerValidator.integer(validation.minItems);
    if (minItems !== null && Array.isArray(value) && value.length < minItems) {
      return this.message(
        field,
        'minItems',
        `Select at least ${minItems} option${minItems === 1 ? '' : 's'} for ${label}.`,
      );
    }

    return null;
  }

  /**
   * Whether an authored pattern rejects this answer. A pattern that will not compile is
   * **ignored**, mirroring the engine's `try`/`catch` — an author's typo in a regex would otherwise
   * make the form permanently unsubmittable.
   */
  private static breaksPattern(pattern: unknown, value: string): boolean {
    if (typeof pattern !== 'string' || pattern === '') return false;

    try {
      return !new RegExp(pattern).test(value);
    } catch {
      return false;
    }
  }

  /** The authored message for this failure, or the supplied default. */
  private message(field: Field, key: string, defaultMessage: string): string {
    const authored = field.validation.errorMessages;
    if (authored && typeof authored === 'object') {
      const value = (authored as Record<string, unknown>)[key];
      if (typeof value === 'string' && value !== '') return value;
    }
    return defaultMessage;
  }

  private static label(field: Field): string {
    return field.label !== '' ? field.label : field.name;
  }

  private static integer(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isNaN(n) ? null : Math.trunc(n);
  }

  private static number(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isNaN(n) ? null : n;
  }

  /** A threshold as an author wrote it: `36`, not `36.00`. */
  private static plain(value: number): string {
    return String(Number(value.toFixed(2)));
  }

  private static isScalar(value: unknown): boolean {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
  }
}
