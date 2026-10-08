/**
 * Ported from storefront-lamp/core/Forms/IntakeResult.php. What happened to one save or one
 * submit.
 *
 * The four outcomes are deliberately distinct rather than collapsed into a boolean plus a message
 * bag, because the funnel treats them differently and conflating two of them is how a visitor ends
 * up in the wrong place: validation errors keep someone on the step to fix them, a stop takes them
 * off the funnel entirely, a plain save advances, and only a finished form opens the next step.
 *
 * A stop carries no field errors on purpose. Someone who answered honestly and is not eligible has
 * not filled the form in wrongly, and telling them so alongside the refusal reads as though
 * correcting a field might change the answer (`[10.43]`).
 */
export class IntakeResult {
  private constructor(
    public readonly errors: Record<string, string>,
    public readonly ruleId: string | null,
    public readonly message: string | null,
    public readonly completed: boolean,
  ) {}

  static invalid(errors: Record<string, string>): IntakeResult {
    return new IntakeResult(errors, null, null, false);
  }

  static stopped(ruleId: string, message: string): IntakeResult {
    return new IntakeResult({}, ruleId, message, false);
  }

  static saved(): IntakeResult {
    return new IntakeResult({}, null, null, false);
  }

  static finished(): IntakeResult {
    return new IntakeResult({}, null, null, true);
  }

  disqualified(): boolean {
    return this.ruleId !== null;
  }

  valid(): boolean {
    return Object.keys(this.errors).length === 0;
  }
}
