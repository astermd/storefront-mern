/**
 * Ported from storefront-lamp/core/Domain/CartOutcome.php. The result of one cart mutation:
 * whether it was applied, and the sentence the buyer is shown. A notice is not an error channel —
 * an accepted mutation carries one too (a quantity capped at the product's maximum), because a
 * change the buyer did not quite ask for must be visible rather than silent.
 */
export class CartOutcome {
  private constructor(
    readonly accepted: boolean,
    readonly notice: string | null,
  ) {}

  static accepted(notice: string | null = null): CartOutcome {
    return new CartOutcome(true, notice);
  }

  static rejected(notice: string): CartOutcome {
    return new CartOutcome(false, notice);
  }
}
