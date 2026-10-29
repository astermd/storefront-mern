import { Field } from './field';
import { FieldState } from './field-state';
import { FileReference } from './file-reference';
import { FileRules } from './file-rules';

/**
 * The text-family types and the `type` attribute each one wants, so the device offers an email
 * keyboard for an email and a dial pad for a phone (`[25.9]`). Anything outside this table is
 * plain `text`.
 */
const INPUT_TYPES: Record<string, string> = { text: 'text', email: 'email', phone: 'tel', password: 'password' };

/**
 * Types whose partial is not named after the type. Everything absent here resolves to
 * `field-<type>.ejs`, which is why `form-progress` and `form-header` need no entry and
 * `picker-date` does.
 */
const TEMPLATE_ALIASES: Record<string, string> = {
  email: 'text',
  phone: 'text',
  password: 'text',
  'picker-date': 'date',
  checkbox: 'boolean',
  toggle: 'boolean',
  terms: 'boolean',
  agreement: 'boolean',
};

/**
 * Strings a boolean field's stored answer may hold that still mean "no". `RuleEvaluator`
 * stringifies booleans as `true`/`false`, so a round-tripped answer can arrive as the word rather
 * than as a falsy value, and a consent box that ticked itself back on would be consent nobody gave
 * (`[26.2]`).
 */
const FALSE_TEXTS = ['', '0', 'false'];

export interface FieldOptionModel {
  value: string;
  label: string;
  selected: boolean;
}

/**
 * Ported from storefront-lamp/core/Forms/FieldViewModel.php. Flattens one authored field, its
 * resolved state and its current answer into the single shape every `partials/intake/field-*`
 * template reads.
 *
 * The type-to-partial branching lives here rather than in the template on purpose. A template that
 * reasoned about field types would put the type vocabulary in two places — `FieldTypes` and the
 * template — and the second copy is always the one that rots. So the templates are told which
 * partial to include and read nothing but this object; `field.ejs` dispatches on `template` and
 * never on `type`.
 *
 * Every key is present for every field, whatever its type — a partial reached through the
 * dispatcher has no access to anything else, and an absent key would be a render-time failure on a
 * page a visitor is mid-way through answering.
 */
export class FieldViewModel {
  /**
   * @param answer the field's own stored answer, except for a `bmi` composite: its result is two
   *   stored answers (the score under the composite's name and the band under `<name>_category`,
   *   `[10.32]`), so a composite is handed the answers keyed by name instead of a bare score.
   * @param state the *resolved* state from `RuleEvaluator.state()` — `required`/`hidden`/`disabled`
   *   come from it rather than from the authored flags, so a field a condition concealed cannot be
   *   marked required in the markup (`[10.19]`).
   */
  static for(field: Field, state: FieldState, answer: unknown, error: string | null): Record<string, unknown> {
    const composite = field.type === 'bmi' && answer && typeof answer === 'object' && !Array.isArray(answer) ? (answer as Record<string, unknown>) : {};
    const own = FieldViewModel.withDefault(field, Object.keys(composite).length === 0 ? answer : (composite[field.name] ?? null));

    return {
      id: field.id,
      name: field.name,
      label: field.label,
      type: field.type,
      description: field.description,
      placeholder: field.placeholder,
      template: FieldViewModel.template(field),
      input_type: FieldViewModel.inputType(field),
      required: state.required,
      hidden: !state.visible,
      disabled: state.disabled,
      readonly: field.readOnly,
      cols: field.cols(),
      // The form author's own CSS hooks. Blank is absent: rendering an empty string gives every
      // such field an id="" no selector can ever match.
      runtime_class: FieldViewModel.optionalText(field.properties.runtimeClassName),
      runtime_id: FieldViewModel.optionalText(field.properties.runtimeId),
      options: FieldViewModel.options(field, own),
      value: FieldViewModel.value(field, own),
      error,
      // Only minted when there is something to point at.
      error_id: error === null ? null : `intake-error-${field.name}`,
      alert_type: FieldViewModel.alertType(field),
      alert_text: FieldViewModel.optionalText(field.properties.alertText),
      category: field.type === 'bmi' ? FieldViewModel.optionalText(composite[`${field.name}_category`]) : null,
      image_url: field.type === 'image' ? FieldViewModel.imageUrl(field) : null,
      button_action: field.type === 'button' ? FieldViewModel.buttonAction(field.properties.buttonAction, field.label) : null,
      // A two-button field ([`buttonCount: 2`]) — a real, live-authored pattern (a "Back"/"Next"
      // pair sharing one field slot) that PHP's own FieldViewModel.php never reads either (only
      // `buttonAction`/the generic `label`), silently rendering one button and dropping the other.
      // This port renders both rather than reproducing that gap. No PHP template to port from for
      // the secondary slot — see field-button.ejs's own doc comment.
      secondary_label: field.type === 'button' && field.properties.buttonCount === 2 ? FieldViewModel.optionalText(field.properties.secondaryButtonLabel) : null,
      secondary_action: field.type === 'button' && field.properties.buttonCount === 2 ? FieldViewModel.buttonAction(field.properties.secondaryButtonAction, FieldViewModel.optionalText(field.properties.secondaryButtonLabel) ?? '') : null,
      max_length: FieldViewModel.constraint(field, 'maxLength'),
      min_value: FieldViewModel.constraint(field, 'minValue'),
      max_value: FieldViewModel.constraint(field, 'maxValue'),
      subfields: FieldViewModel.subfields(field, composite),
      files: field.isFileUpload() ? FieldViewModel.files(own) : [],
      upload: field.isFileUpload() ? FieldViewModel.upload(field) : null,
      signature: field.isSignature() ? FieldViewModel.signaturePad(field) : null,
      // The field's own conditions, for the stepper to re-evaluate as answers change.
      conditions_json: field.conditions.length === 0 ? null : JSON.stringify(field.conditions),
    };
  }

  /**
   * `properties.hidden` asks for a field that carries a value without ever being drawn as a
   * control a visitor sees — the value comes from somewhere else (a prefilled answer, a default)
   * and only needs to travel with the submission. Overriding `input_type` to `'hidden'` is enough:
   * `field-text.ejs` renders a bare `<input type="hidden">` instead of its usual labelled control,
   * from the same authored `type`. This is distinct from the `hidden` this method's caller sets
   * from `state.visible`: that one conceals a control a visitor could otherwise see and answer;
   * this one says the form never intended one.
   */
  private static inputType(field: Field): string {
    if (field.properties.hidden === true) return 'hidden';
    return INPUT_TYPES[field.type] ?? 'text';
  }

  /**
   * `properties.defaultValue` fills in only when nothing has been answered (`answer === null`): a
   * visitor who answered and then cleared the box gets their empty answer back, not the form
   * author's default overwriting it. Guarded by `hasDefaultValue` rather than by `defaultValue`
   * alone, so a default of `''` or `'0'` — a real, intentional value — is still applied rather than
   * read as absent. Never applies to a `bmi` composite: its value is a computed score, not
   * something a form author writes in ahead of time. Resolved once, ahead of both `value()` and
   * `options()`, so a default choice reaches the page both as the value a hidden input carries and
   * as the option `options()` marks selected.
   */
  private static withDefault(field: Field, answer: unknown): unknown {
    if (answer === null && field.type !== 'bmi' && field.properties.hasDefaultValue === true) {
      return field.properties.defaultValue ?? null;
    }

    return answer;
  }

  /** An unsupported type is checked before the table rather than after, so a type that merely happens to share a name with a partial on disk cannot sneak past the default-deny vocabulary (`[10.13]`). */
  private static template(field: Field): string {
    if (!field.isSupported()) return 'field-unsupported';

    // A `choice-multi` that accepts one answer is drawn with radios, and the alias table cannot
    // express that: it is keyed on the type, and the two controls share one.
    if (field.type === 'choice-multi' && !field.isMultiValue()) return 'field-choice-single';

    return `field-${TEMPLATE_ALIASES[field.type] ?? field.type}`;
  }

  /** The answer as the partial needs it. */
  private static value(field: Field, answer: unknown): unknown {
    if (field.type === 'bmi') {
      return typeof answer === 'number' || (typeof answer === 'string' && !Number.isNaN(Number(answer)) && answer.trim() !== '')
        ? Number(answer)
        : null;
    }

    if (field.isBoolean()) {
      return typeof answer === 'string' ? !FALSE_TEXTS.includes(answer.toLowerCase().trim()) : Boolean(answer);
    }

    if (field.isMultiValue()) {
      return FieldViewModel.valueList(answer);
    }

    return answer ?? '';
  }

  /** The authored options with the current selection marked. */
  private static options(field: Field, answer: unknown): FieldOptionModel[] {
    const selected = field.isMultiValue() ? FieldViewModel.valueList(answer) : null;
    const scalar = selected === null ? FieldViewModel.scalarText(answer) : null;

    return field.options().map((option) => ({
      value: option.value,
      label: option.label,
      selected: selected === null ? scalar !== null && scalar === option.value : selected.includes(option.value),
    }));
  }

  /**
   * A composite's parts as full view models, so `field-bmi.ejs` can recurse back through the
   * dispatcher and get the same markup a top-level field of that type would get.
   *
   * Their state is the authored state rather than a resolved one: conditions attach to fields, not
   * to subfields.
   */
  private static subfields(field: Field, answers: Record<string, unknown>): Record<string, unknown>[] {
    const models = field.subfields.map((subfield) => {
      const visible = !subfield.hidden;
      return FieldViewModel.for(
        subfield,
        new FieldState(visible, subfield.disabled, visible && !subfield.disabled && subfield.required),
        answers[subfield.name] ?? null,
        null,
      );
    });

    // A composite owns the row the page gave it and lays its own parts out against its own
    // two-column grid, so their authored `cols` does not apply here.
    for (const model of models) {
      model.cols = 2;
    }

    return models;
  }

  /**
   * The files already attached, each with the JSON its hidden input posts back and the name to
   * show.
   *
   * The EMR stores a file under its own name with a UUID before the extension, so the name shown is
   * that one with the UUID taken out — near enough to what the patient picked to recognise it.
   */
  private static files(answer: unknown): Array<{ label: string; json: string }> {
    const files: Array<{ label: string; json: string }> = [];
    for (const entry of Array.isArray(answer) ? answer : []) {
      const reference = FileReference.fromArray(entry);
      if (reference === null) continue;

      files.push({
        label: reference.name.replace(/-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}(?=\.[^.]*$|$)/i, ''),
        json: JSON.stringify(reference.toArray()),
      });
    }

    return files;
  }

  private static upload(field: Field): { max_files: number | null; max_bytes: number; max_label: string; accept: string; drag_drop: boolean } {
    const rules = FileRules.for(field);

    return {
      max_files: rules.maxFiles,
      max_bytes: rules.maxBytes,
      max_label: FileRules.megabytes(rules.maxBytes),
      accept: rules.accept(),
      drag_drop: rules.dragDrop,
    };
  }

  /**
   * The pad's drawing size as authored, within reason: the builder's default is 320 by 220, and
   * the pad is scaled down to fit a narrow screen whatever is set here.
   */
  private static signaturePad(field: Field): { width: number; height: number } {
    return {
      width: FieldViewModel.clampedSize(field.properties.signatureCanvasWidth, 160, 800, 320),
      height: FieldViewModel.clampedSize(field.properties.signatureCanvasHeight, 80, 400, 220),
    };
  }

  private static clampedSize(raw: unknown, min: number, max: number, fallback: number): number {
    const numeric = typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '') ? Number(raw) : Number.NaN;
    return Number.isFinite(numeric) ? Math.max(min, Math.min(max, Math.trunc(numeric))) : fallback;
  }

  private static alertType(field: Field): string {
    return FieldViewModel.optionalText(field.properties.alertType) ?? 'info';
  }

  /** Two spellings are in the wild for the same property, and neither is wrong. */
  private static imageUrl(field: Field): string | null {
    return FieldViewModel.optionalText(field.properties.imageUrl) ?? FieldViewModel.optionalText(field.properties.url);
  }

  private static constraint(field: Field, key: string): number | null {
    const value = field.validation[key];
    return typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) ? Number(value) : null;
  }

  private static valueList(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.map((entry) => FieldViewModel.scalarText(entry)).filter((t): t is string => t !== null);
    }
    const text = FieldViewModel.scalarText(value);
    return text === null ? [] : [text];
  }

  /**
   * `intake.js` only wires `next_page`/`previous_page`/`submit`; any other authored value (a live
   * form authors `none` on both buttons of a Back/Next pair) renders a button that does nothing.
   * An unrecognised action is inferred from the label instead, so the visitor is never stranded.
   */
  private static buttonAction(raw: unknown, label: string): string {
    const action = FieldViewModel.optionalText(raw);
    if (action === null) return 'next_page';
    if (['next_page', 'previous_page', 'submit'].includes(action)) return action;
    return /\b(back|previous)\b/i.test(label) ? 'previous_page' : 'next_page';
  }

  private static optionalText(value: unknown): string | null {
    const text = FieldViewModel.scalarText(value);
    return text === null || text.trim() === '' ? null : text;
  }

  private static scalarText(value: unknown): string | null {
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    return null;
  }
}
