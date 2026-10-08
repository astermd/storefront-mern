/**
 * Ported from storefront-lamp/core/Forms/FieldState.php. One field's resolved visibility, disabled
 * and required flags for a given set of answers — what `RuleEvaluator.state()` returns.
 */
export class FieldState {
  constructor(
    public readonly visible: boolean,
    public readonly disabled: boolean,
    public readonly required: boolean,
  ) {}
}
