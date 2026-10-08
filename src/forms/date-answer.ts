/**
 * Ported from storefront-lamp/core/Forms/DateAnswer.php. A `picker-date` answer as the EMR wants
 * it: `YYYY-MM-DD`.
 *
 * **The stored answer stays as the visitor typed it.** This converts at the outbound boundary and
 * nowhere else: the journey keeps `MM / DD / YYYY` because that is what goes back into the box when
 * the form re-renders.
 *
 * **Month first, and that is the one thing that must not be guessed.** The field's placeholder
 * says `MM / DD / YYYY`, so `03/04` is the fourth of March — read the same shape the picker does
 * rather than delegating to a permissive parser.
 *
 * **A date that does not exist answers null rather than the nearest one that does.** A permissive
 * parser rolls 31 February forward into March, turning a typo into a plausible wrong date of birth
 * on a clinical record.
 */
export class DateAnswer {
  /** The shape the field accepts. */
  private static readonly TYPED = /^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})$/;

  /** What this converts to, and therefore also passes through untouched. */
  private static readonly ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

  /**
   * This answer as `YYYY-MM-DD`, or null when it is not a date this field could have produced.
   *
   * Null is "leave it alone", not "reject it": validation is `AnswerValidator`'s job.
   */
  static iso(answer: string): string | null {
    const value = answer.trim();

    const isoMatch = value.match(DateAnswer.ISO);
    if (isoMatch) {
      return DateAnswer.real(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
    }

    const typedMatch = value.match(DateAnswer.TYPED);
    if (!typedMatch) return null;

    return DateAnswer.real(Number(typedMatch[3]), Number(typedMatch[1]), Number(typedMatch[2]));
  }

  /** The date, or null when those three numbers do not name one. */
  private static real(year: number, month: number, day: number): string | null {
    if (!DateAnswer.isValidDate(year, month, day)) return null;

    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  /** PHP's `checkdate()`: month 1-12, day valid for that month/year, including leap years. */
  private static isValidDate(year: number, month: number, day: number): boolean {
    if (month < 1 || month > 12 || day < 1) return false;
    const daysInMonth = new Date(year, month, 0).getDate();
    return day <= daysInMonth;
  }
}
