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
 *
 * A file upload and a signature are supported only where the browser can reach the storefront's
 * upload endpoints, which is the server renderer. The hosted engine keeps a picked file's name and
 * size and never its bytes, and draws no signature pad at all, so under that renderer both stay
 * unsupported and block the form exactly as an unknown type does.
 */
export class FieldTypes {
  /**
   * The date field, named because two outbound boundaries have to recognise it to convert what it
   * collects (`MM / DD / YYYY`) into what the EMR stores (`YYYY-MM-DD`).
   */
  static readonly PICKER_DATE = 'picker-date';

  /** A question answered with one or more files, uploaded to the EMR as they are picked. */
  static readonly FILE_UPLOAD = 'file-upload';

  /** A drawn signature, carried in the answer itself as a PNG data URL. */
  static readonly SIGNATURE = 'signature';

  /**
   * The type the intake-submission API files both of the above under. It collapses the builder's
   * types into a small set, and these two are the ones whose answer is not plain text, so a reader
   * of the submission has to be told.
   */
  static readonly SUBMITTED_FILE_TYPE = 'file';

  /** Types that hold a submitted answer. */
  static readonly VALUE_TYPES = [
    'text', 'textarea', 'email', 'phone', 'number', 'password',
    FieldTypes.PICKER_DATE, 'choice-single', 'choice-multi', 'dropdown',
    'checkbox', 'toggle', 'terms', 'agreement', 'bmi', 'hidden',
    FieldTypes.FILE_UPLOAD, FieldTypes.SIGNATURE,
  ]; // prettier-ignore

  /** Value types only a renderer that can upload files is able to collect. */
  static readonly FILE_TYPES = [FieldTypes.FILE_UPLOAD, FieldTypes.SIGNATURE];

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

  /**
   * @param collectsFiles whether the renderer in use can collect a file or a signature; false under
   *   the hosted engine
   */
  static supported(type: string, collectsFiles = true): boolean {
    if (!collectsFiles && FieldTypes.FILE_TYPES.includes(type)) return false;

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
