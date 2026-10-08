import { Promotion } from './promotion';

/**
 * Ported from storefront-lamp/core/Checkout/Totals.php. Money is integer cents everywhere; this
 * is the only place that computes a checkout total from a subtotal and a promotion, and the only
 * two named exits that convert to a display value.
 *
 * No tax/shipping lines — all-inclusive pricing (`[13.35]` declared gap).
 */
export class Totals {
  private constructor(
    public readonly subtotalCents: number,
    public readonly discountCents: number,
    public readonly totalCents: number,
  ) {}

  static of(subtotalCents: number, promotion: Promotion | null): Totals {
    const subtotal = Math.max(0, subtotalCents);
    const discount = Math.min(subtotal, Math.max(0, promotion?.discountCents ?? 0));
    return new Totals(subtotal, discount, subtotal - discount);
  }

  /** The only exit to a display dollar figure. */
  static dollars(cents: number): number {
    return Math.round(cents) / 100;
  }

  /** The only exit to a fixed 2-decimal string. */
  static decimalString(cents: number): string {
    return (Math.round(cents) / 100).toFixed(2);
  }
}
