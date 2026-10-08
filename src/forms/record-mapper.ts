import { Injectable } from '@nestjs/common';
import { OperatorLog } from '../support/operator-log';
import { AnswerSet } from './answer-set';
import { Bmi } from './bmi';
import { DateAnswer } from './date-answer';
import { Definition } from './definition';
import { Field } from './field';
import { FieldTypes } from './field-types';
import { TeleformMetadata } from './teleform-metadata';

/** The one record this storefront writes. */
const ROOT = 'opportunity';

/**
 * Which targets hold a body measurement, matched on the **path** rather than the field name, and
 * with or without a trailing `.value`.
 */
const HEIGHT_TARGET = /(^|\.)height(\.value)?$/;
const WEIGHT_TARGET = /(^|\.)weight(\.value)?$/;

/**
 * Targets the record stores as a list even though the form collects them as one free-text answer.
 * The EMR rejects `clinical.medications` and `clinical.allergies` written as a bare string;
 * wrapping the whole answer in a single-element list is the safe conversion, because splitting it
 * on commas would guess at a delimiter the visitor never agreed to.
 */
const LIST_TARGET = /(^|\.)(medications|allergies)$/;

const INCHES_TO_CENTIMETRES = 2.54;
const POUNDS_TO_KILOGRAMS = 0.45359237;

/**
 * Ported from storefront-lamp/core/Forms/RecordMapper.php. Turns answers into the nested EMR
 * record the teleform's own `db_fields` map asks for.
 *
 * The map is authored alongside the form: a target is a dotted path such as
 * `opportunity.clinical.height.value`, and this class expands it into the nesting the API expects.
 *
 * **Why the whole answer set, every time.** `build()` rebuilds the entire payload from everything
 * known so far rather than from the page that was just saved, which is `[11.5]`: because a write
 * always carries the full record, a later partial save can never unset a field an earlier one
 * wrote.
 *
 * Only the `opportunity` root is written (`[11.3]`, `[11.11]`). Another root is skipped but
 * skipped *loudly*, once per distinct root — the log line carries the root and the field's name
 * and never its answer.
 */
@Injectable()
export class RecordMapper {
  constructor(private readonly log: OperatorLog) {}

  /**
   * The `opportunity`-rooted payload for everything answered so far. An answer that is absent or
   * empty contributes nothing (`[11.4]`), so an unanswered question leaves whatever the record
   * already holds alone instead of blanking it.
   */
  build(metadata: TeleformMetadata, answers: AnswerSet, definition: Definition): Record<string, unknown> {
    const unitSystem = RecordMapper.unitSystem(answers, definition);
    let payload: Record<string, unknown> = {};
    const reported = new Set<string>();

    // `metadata.dbFields` is keyed by fieldId on a real teleform, not by the answer name this
    // loop needs — see `Definition.resolveDbFields()`'s doc comment.
    const dbFields = definition.resolveDbFields(metadata.dbFields);

    for (const [name, target] of Object.entries(dbFields)) {
      const segments = RecordMapper.segments(target);
      const root = segments.shift();

      if (root !== ROOT) {
        if (root !== undefined && !reported.has(root)) {
          reported.add(root);
          this.log.warning('intake.unmapped_target_root', { root, field: name });
        }
        continue;
      }

      // A target that is the bare root names no property to write into.
      if (segments.length === 0) continue;

      let value = answers.value(name);
      if (!RecordMapper.present(value)) continue;

      // A one-element list is written as the value it holds. Form authors routinely build a
      // single-answer question out of a multi-select control, and the record's fields are
      // scalars.
      if (Array.isArray(value) && value.length === 1) {
        this.log.info('intake.multi_value_flattened', { field: name, target });
        value = value[0];
      }

      payload = RecordMapper.place(payload, segments, RecordMapper.normalise(target, value, unitSystem, definition.field(name)));
    }

    return payload;
  }

  /**
   * Whether this payload carries enough to be worth sending as a lead. `[11.6]`'s threshold is a
   * first name and an email.
   */
  ready(payload: Record<string, unknown>): boolean {
    return RecordMapper.filled(payload.first_name) && RecordMapper.filled(payload.email);
  }

  /**
   * Which unit system the visitor's measurements are in.
   *
   * Read from whichever answer the definition's BMI composite names as its unit part, rather than
   * a fixed field name. A form with no composite, or one whose unit dropdown is hidden and
   * therefore unanswered, falls back to `Bmi.unitSystem()`'s default (`[10.29]`).
   */
  private static unitSystem(answers: AnswerSet, definition: Definition): string {
    for (const field of definition.fields()) {
      if (field.type !== 'bmi') continue;

      for (const subfield of field.subfields) {
        const described = `${subfield.name} ${subfield.label}`.toLowerCase();
        if (described.includes('unit') || described.includes('system')) {
          const answered = answers.value(subfield.name);
          return Bmi.unitSystem(RecordMapper.isScalar(answered) ? String(answered) : null);
        }
      }
    }

    return Bmi.unitSystem(null);
  }

  /**
   * A measurement in the units the record stores, or the answer untouched.
   *
   * Height is whole centimetres and weight is kilograms to one decimal. A value that is not a
   * number at all passes through unconverted rather than becoming a nonsense zero.
   */
  private static normalise(target: string, value: unknown, unitSystem: string, field: Field | null): unknown {
    // A date is recognised by the field's own type rather than by its target path.
    if (field?.type === FieldTypes.PICKER_DATE && RecordMapper.isScalar(value)) {
      return DateAnswer.iso(String(value)) ?? value;
    }

    if (LIST_TARGET.test(target)) {
      return Array.isArray(value) ? value : [value];
    }

    if (!RecordMapper.isScalar(value) || Number.isNaN(Number(String(value).trim())) || String(value).trim() === '') {
      return value;
    }

    const number = Number(String(value).trim());
    const imperial = unitSystem === Bmi.IMPERIAL;

    if (HEIGHT_TARGET.test(target)) {
      return Math.round(imperial ? number * INCHES_TO_CENTIMETRES : number);
    }

    if (WEIGHT_TARGET.test(target)) {
      return Math.round((imperial ? number * POUNDS_TO_KILOGRAMS : number) * 10) / 10;
    }

    return value;
  }

  /** Writes one value at a dotted path, creating the intermediate levels. */
  private static place(payload: Record<string, unknown>, segments: string[], value: unknown): Record<string, unknown> {
    const [key, ...rest] = segments;

    if (rest.length === 0) {
      return { ...payload, [key]: value };
    }

    const child = payload[key];
    return { ...payload, [key]: RecordMapper.place(child && typeof child === 'object' ? (child as Record<string, unknown>) : {}, rest, value) };
  }

  /** The path's segments, with empty ones dropped so a stray dot cannot create a nameless level. */
  private static segments(target: string): string[] {
    return target.split('.').filter((s) => s.trim() !== '');
  }

  /** Whether an answer is worth writing. A `false` counts: an unticked acknowledgement is a real answer. */
  private static present(value: unknown): boolean {
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'boolean') return true;
    return RecordMapper.isScalar(value) && String(value).trim() !== '';
  }

  private static filled(value: unknown): boolean {
    return RecordMapper.isScalar(value) && String(value).trim() !== '';
  }

  private static isScalar(value: unknown): boolean {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
  }
}
