/**
 * Ported from storefront-lamp/core/Forms/FieldTypes.php. Which authored field types this renderer
 * implements, and — the part that matters — which it refuses.
 *
 * `[10.13]` is the failure this class exists to prevent: a form authored with a type the renderer
 * does not know used to lose those questions with no error at all, so a clinician read an intake
 * that silently omitted whatever was asked. The rule adopted instead is implement-or-fail-loudly,
 * and the classification is **default-deny**: a type in neither list is unsupported, so a type the
 * EMR adds after this ships surfaces as a stated error on a blocked form rather than as a question
 * nobody answered.
 *
 * `hidden` sits in the value set rather than the display set on purpose (`[10.11]`): it is not
 * displayed but it does carry a value, which is how a computed answer like a BMI score reaches the
 * record.
 */
export class FieldTypes {
  /**
   * The date field, named because two outbound boundaries have to recognise it to convert what it
   * collects (`MM / DD / YYYY`) into what the EMR stores (`YYYY-MM-DD`).
   */
  static readonly PICKER_DATE = 'picker-date';

  /**
   * Types that hold a submitted answer.
   *
   * `file-upload` is a deliberate divergence from the PHP original's own `FieldTypes.php`, which
   * has no equivalent — the PHP codebase never wired one up. `@astermd-hq/sdk`'s
   * `intakeSubmissions().uploadFile()` genuinely supports it, and a real live teleform (Rameltion's)
   * turned out to need it, so this port implements it for real rather than refusing every
   * questionnaire that asks for a document. See `IntakeGateway.uploadFile()`/`field-file-upload.ejs`.
   */
  static readonly VALUE_TYPES = [
    'text', 'textarea', 'email', 'phone', 'number', 'password', 'file-upload',
    FieldTypes.PICKER_DATE, 'choice-single', 'choice-multi', 'dropdown',
    'checkbox', 'toggle', 'terms', 'agreement', 'bmi', 'hidden',
  ]; // prettier-ignore

  /**
   * Structural and display-only elements. They render, and they carry no submitted value — so
   * they are excluded from validation and from everything sent to the EMR (`[10.12]`).
   */
  static readonly DISPLAY_TYPES = [
    'heading', 'form-header', 'paragraph', 'divider',
    'alert', 'image', 'form-progress', 'button',
  ]; // prettier-ignore

  /** Types whose answer is always a list, however many options are selected (`[10.36]`). */
  static readonly MULTI_VALUE_TYPES = ['choice-multi'];

  /** Types whose answer is a boolean rather than a string. */
  static readonly BOOLEAN_TYPES = ['checkbox', 'toggle', 'terms', 'agreement'];

  static supported(type: string): boolean {
    return FieldTypes.VALUE_TYPES.includes(type) || FieldTypes.DISPLAY_TYPES.includes(type);
  }

  static isDisplayOnly(type: string): boolean {
    return FieldTypes.DISPLAY_TYPES.includes(type);
  }

  static isMultiValue(type: string): boolean {
    return FieldTypes.MULTI_VALUE_TYPES.includes(type);
  }

  static isBoolean(type: string): boolean {
    return FieldTypes.BOOLEAN_TYPES.includes(type);
  }
}
