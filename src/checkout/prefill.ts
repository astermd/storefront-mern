import { AnswerSet } from '../forms/answer-set';
import { Definition } from '../forms/definition';
import { TeleformMetadata } from '../forms/teleform-metadata';

/**
 * Record path -> the checkout field that wants it. Only paths with somewhere to go appear.
 */
const FIELD_FOR_PATH: Record<string, string> = {
  'opportunity.first_name': 'first_name',
  'opportunity.last_name': 'last_name',
  'opportunity.email': 'email',
  'opportunity.phone': 'phone',
  'opportunity.address.line1': 'address_line',
  'opportunity.address.address1': 'address_line',
  'opportunity.address.street': 'address_line',
  'opportunity.address.city': 'city',
  'opportunity.address.state': 'territory',
  'opportunity.address.postal_code': 'postal_code',
  'opportunity.address.zip': 'postal_code',
};

/** Fields normalised to upper case on the way in (`[13.1]`). */
const UPPERCASED = ['territory'];

/**
 * Ported from storefront-lamp/core/Checkout/Prefill.php. Checkout fields, filled from what the
 * intake already asked (`[13.5b]`).
 *
 * The intake's own `db_fields` map is read **backwards**. That map says which record path each
 * answer writes to — `date_of_birth -> opportunity.dob` — and this class asks the opposite
 * question: which answer ends up at `opportunity.email`. Using the same map in both directions is
 * what `[13.5b]` means by "one mapping, not two": a clinician who renames a question keeps prefill
 * working, because the record path did not move.
 *
 * Precedence is stored answers first, working state second (`[13.5c]`). An empty stored answer
 * does not count as an answer — someone who skipped an optional question and typed the value at
 * checkout must not have it wiped on the next render.
 *
 * A cart with no questionnaire passes null for both intake arguments and gets working state alone
 * (`[13.5g]`).
 */
export class Prefill {
  static from(
    metadata: TeleformMetadata | null,
    definition: Definition | null,
    answers: AnswerSet | null,
    workingState: Record<string, string>,
  ): Record<string, string> {
    const prefilled: Record<string, string> = {};

    if (metadata !== null && definition !== null && answers !== null) {
      // `metadata.dbFields` is keyed by fieldId on a real teleform, not by the answer name
      // `answers.value()` needs — see `Definition.resolveDbFields()`'s doc comment. Without this,
      // a real checkout page's email/name/etc. never prefilled from a real intake answer, even
      // though the mapping and the answer were both there.
      const dbFields = definition.resolveDbFields(metadata.dbFields);

      for (const [answerName, recordPath] of Object.entries(dbFields)) {
        const field = FIELD_FOR_PATH[recordPath];
        if (field === undefined) continue;

        const value = Prefill.scalar(answers.value(answerName));
        if (value === '') continue;

        prefilled[field] = value;
      }
    }

    for (const [field, raw] of Object.entries(workingState)) {
      const value = Prefill.scalar(raw);
      if (value === '' || (prefilled[field] ?? '') !== '') continue;

      prefilled[field] = value;
    }

    for (const field of UPPERCASED) {
      if (prefilled[field] !== undefined) {
        prefilled[field] = prefilled[field].toUpperCase();
      }
    }

    return prefilled;
  }

  /**
   * One answer as a string. A single-element list is flattened to the value it holds, matching
   * what `RecordMapper` does on the write side.
   */
  private static scalar(value: unknown): string {
    let resolved = value;
    if (Array.isArray(resolved)) {
      resolved = resolved.length === 1 ? resolved[0] : '';
    }

    return typeof resolved === 'string' || typeof resolved === 'number' || typeof resolved === 'boolean' ? String(resolved).trim() : '';
  }
}
