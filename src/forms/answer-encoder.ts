import { AnswerSet } from './answer-set';
import { DateAnswer } from './date-answer';
import { Definition } from './definition';
import { Field } from './field';
import { FieldTypes } from './field-types';

export interface EncodedAnswer {
  id: string;
  name: string;
  label: string;
  type: string;
  value: Record<string, unknown>[];
}

/**
 * Ported from storefront-lamp/core/Forms/AnswerEncoder.php. Rewrites an answer set as the field
 * list the intake-submission API stores.
 *
 * The wire shape is not ours to choose: each answer travels as a self-describing entry — its id,
 * name, label, type and a **list** of values — so the submission stays readable years later, after
 * the form has been republished and its questions reworded.
 *
 * Choice answers carry their option **label** beside the stored value for the same reason: `value`
 * is a slug the form author chose and `label` is the sentence the visitor actually read.
 *
 * Two exclusions, both `[10.12]`: a display-only element has no answer to send, and an unanswered
 * field is left out entirely rather than sent as an empty string.
 *
 * `sendToProvider: false` is deliberately **not** a third exclusion here: it governs whether
 * `RecordMapper` writes a field into the EMR's clinical record — that class gates on `db_field`
 * instead, and a field with no `db_field` never reaches the record regardless of this flag. This
 * encoder feeds the intake-submission draft, the visitor's own in-progress answers, and
 * withholding a storefront-only field from that draft has no spec behind it.
 */
export class AnswerEncoder {
  static encode(definition: Definition, answers: AnswerSet): EncodedAnswer[] {
    const encoded: EncodedAnswer[] = [];

    for (const field of definition.fields()) {
      if (field.isDisplayOnly()) continue;

      const values = AnswerEncoder.values(field, answers.value(field.name));
      if (values.length === 0) continue;

      encoded.push({ id: field.id, name: field.name, label: field.label, type: field.type, value: values });
    }

    return encoded;
  }

  /**
   * One field's answer as the API's value list.
   *
   * An empty list means "nothing to send" and drops the field. A stored `false` is not blank — an
   * acknowledgement the visitor declined is a real answer.
   */
  private static values(field: Field, answer: unknown): Record<string, unknown>[] {
    if (Array.isArray(answer)) {
      const values: Record<string, unknown>[] = [];
      for (const entry of answer) {
        if (AnswerEncoder.isScalar(entry)) {
          values.push(AnswerEncoder.entry(field, entry as string | number));
        }
      }
      return values;
    }

    if (typeof answer === 'boolean') {
      return [{ value: answer }];
    }

    if (!AnswerEncoder.isScalar(answer) || String(answer).trim() === '') {
      return [];
    }

    return [AnswerEncoder.entry(field, answer as string | number)];
  }

  /**
   * One value in the form the record wants it, which today means a date. A value `DateAnswer.iso`
   * cannot read passes through untouched — deciding an answer is wrong is `AnswerValidator`'s job.
   */
  private static normalise(field: Field, value: string | number): string | number {
    if (field.type !== FieldTypes.PICKER_DATE) return value;
    return DateAnswer.iso(String(value)) ?? value;
  }

  /** One value, with the label of the option it came from when the field declares options. */
  private static entry(field: Field, value: string | number): Record<string, unknown> {
    const entry: Record<string, unknown> = { value: AnswerEncoder.normalise(field, value) };

    for (const option of field.options()) {
      if (option.value === String(value)) {
        entry.label = option.label;
        break;
      }
    }

    return entry;
  }

  private static isScalar(value: unknown): boolean {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
  }
}
