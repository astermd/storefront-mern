import { Bmi } from './bmi';
import { Definition } from './definition';
import { Field } from './field';
import { FileReference, StoredFile } from './file-reference';

const COMPOSITE_BMI = 'bmi';

/** Scalars a checkbox-like field accepts as "checked"; everything else is unchecked. */
const TRUTHY = ['true', '1', 'on'];

/**
 * A drawn signature: a PNG and nothing else, as a base64 data URL. The pad draws a few kilobytes;
 * the cap is there so the answer cannot be used to park megabytes in the journey.
 */
const SIGNATURE_SHAPE = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;
const SIGNATURE_MAX_LENGTH = 1024 * 1024;

/**
 * Ported from storefront-lamp/core/Forms/AnswerSet.php. The answers a visitor has given so far,
 * keyed by field name.
 *
 * Two rules shape the whole class. The first is `[10.27]`: answers **accumulate**. A save carries
 * only the page that was just filled in, so merging rather than replacing is what lets a visitor
 * step back, change one box, step forward, or return days later on another device without silently
 * emptying every question they are not currently looking at. The second is `[10.36]`: a
 * multi-select answer is a list however many options are chosen.
 *
 * Immutability is deliberate. Every mutation returns a new instance instead of mutating in place.
 *
 * `merge()` is also the **filter**: a name the definition does not declare is dropped, and so is a
 * value posted for a display-only field (`[10.12]`, `[10.22]`).
 *
 * Derivation is server-side for the same reason (`[10.45]`). The BMI composite's value is not
 * answered, it is computed, and the recorded form disqualifies on `bmi_measurement less_than '27'`
 * — so a score computed only in the browser would let a disqualifying answer straight through
 * whenever scripts are absent, blocked or bypassed. `withDerived()` runs on the server on every
 * save, before any rule is evaluated.
 */
export class AnswerSet {
  private constructor(private readonly values: Record<string, unknown>) {}

  static empty(): AnswerSet {
    return new AnswerSet({});
  }

  /**
   * Rehydrates a stored set. Values that have already been through `merge()` were filtered and
   * coerced when they were written, so they are trusted as-is here.
   */
  static fromArray(stored: Record<string, unknown>): AnswerSet {
    return new AnswerSet(stored);
  }

  /** Folds one page's worth of posted values into the set and returns the result, leaving this instance untouched. */
  merge(incoming: Record<string, unknown>, definition: Definition): AnswerSet {
    const values = { ...this.values };

    for (const [name, value] of Object.entries(incoming)) {
      const field = definition.field(name);
      if (field === null || field.isDisplayOnly()) continue;

      // An array posted for a single-value field is malformed rather than empty, so the answer
      // already on file is left alone.
      if (Array.isArray(value) && !field.isMultiValue() && !field.isFileUpload()) continue;

      values[field.name] = AnswerSet.coerce(field, value);
    }

    return new AnswerSet(values);
  }

  /**
   * Recomputes every derived answer and returns the result.
   *
   * Idempotent by construction. A composite missing either measurement derives **nothing**, not
   * zero — zero would satisfy a "BMI below 27" hard stop and disqualify a visitor who has simply
   * not finished typing the second number.
   */
  withDerived(definition: Definition): AnswerSet {
    const values = { ...this.values };

    for (const field of definition.fields()) {
      if (field.type !== COMPOSITE_BMI) continue;

      const score = AnswerSet.bmiScore(field, values);
      if (score === null) {
        delete values[field.name];
        delete values[`${field.name}_category`];
        continue;
      }

      values[field.name] = score;
      values[`${field.name}_category`] = Bmi.category(score);
    }

    return new AnswerSet(values);
  }

  all(): Record<string, unknown> {
    return this.values;
  }

  value(name: string): unknown {
    return this.values[name] ?? null;
  }

  has(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.values, name);
  }

  /**
   * Normalises one posted value to the shape its field's type stores in.
   *
   * A number stays a **string**: the evaluator coerces at comparison time, and reformatting here
   * would replace what the visitor typed with our idea of it.
   */
  private static coerce(field: Field, value: unknown): unknown {
    if (field.isFileUpload()) return AnswerSet.toFiles(value);

    if (field.isSignature()) {
      return typeof value === 'string' && value.length <= SIGNATURE_MAX_LENGTH && SIGNATURE_SHAPE.test(value) ? value : '';
    }

    if (field.isMultiValue()) return AnswerSet.toList(value);
    if (field.isBoolean()) return AnswerSet.toBool(value);
    return AnswerSet.isScalar(value) ? String(value) : '';
  }

  /**
   * The files attached to a file-upload question, as stored references.
   *
   * The page posts one JSON reference per attached file beside an empty entry, so a question whose
   * last file was removed still arrives, as a list with nothing in it, rather than not at all and
   * leaving the removed file on file. Whose files they are is not decided here: the journey's
   * session is checked before anything is merged (`IntakeSession.ownFiles()`).
   */
  private static toFiles(value: unknown): StoredFile[] {
    const files = new Map<string, StoredFile>();
    for (const entry of Array.isArray(value) ? value : [value]) {
      const reference = FileReference.fromPosted(entry);
      if (reference !== null) files.set(reference.path, reference.toArray());
    }

    return [...files.values()];
  }

  private static toList(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.filter((entry) => AnswerSet.isScalar(entry)).map((entry) => String(entry));
    }

    // A cleared multi-select posts nothing at all, or an empty string from a hidden companion
    // input; both mean "no options chosen".
    if (value === null || value === undefined || value === '' || value === false) return [];

    return AnswerSet.isScalar(value) ? [String(value)] : [];
  }

  private static toBool(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    return AnswerSet.isScalar(value) && TRUTHY.includes(String(value).toLowerCase().trim());
  }

  /**
   * The score for one BMI composite, read from whatever the form named its parts.
   *
   * The subfield names are taken from the definition rather than hardcoded, because the
   * composite's parts are authored like any other field and a second form is free to call them
   * something else.
   */
  private static bmiScore(composite: Field, values: Record<string, unknown>): number | null {
    const parts = AnswerSet.bmiParts(composite);

    const height = AnswerSet.toFloat(parts.height === null ? null : (values[parts.height] ?? null));
    const weight = AnswerSet.toFloat(parts.weight === null ? null : (values[parts.weight] ?? null));
    if (height === null || weight === null) return null;

    const unit = parts.unit === null ? null : (values[parts.unit] ?? null);

    return Bmi.score(Bmi.unitSystem(AnswerSet.isScalar(unit) ? String(unit) : null), height, weight);
  }

  /**
   * Which declared subfield name plays each role in the composite.
   *
   * Roles are read from the authored name and label first, and fall back to the authored order of
   * the numeric subfields — height then weight — so a composite whose parts are named opaquely
   * still derives.
   */
  private static bmiParts(composite: Field): { unit: string | null; height: string | null; weight: string | null } {
    let unit: string | null = null;
    let height: string | null = null;
    let weight: string | null = null;
    const unclaimedNumbers: string[] = [];

    for (const subfield of composite.subfields) {
      const described = `${subfield.name} ${subfield.label}`.toLowerCase();

      if (height === null && described.includes('height')) {
        height = subfield.name;
      } else if (weight === null && described.includes('weight')) {
        weight = subfield.name;
      } else if (unit === null && (described.includes('unit') || described.includes('system'))) {
        unit = subfield.name;
      } else if (subfield.type === 'number') {
        unclaimedNumbers.push(subfield.name);
      }
    }

    return {
      unit,
      height: height ?? unclaimedNumbers.shift() ?? null,
      weight: weight ?? unclaimedNumbers.shift() ?? null,
    };
  }

  private static toFloat(value: unknown): number | null {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return null;

    const trimmed = value.trim();
    if (trimmed === '' || Number.isNaN(Number(trimmed))) return null;
    return Number(trimmed);
  }

  private static isScalar(value: unknown): boolean {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
  }
}
