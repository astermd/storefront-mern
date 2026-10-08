/**
 * Ported from storefront-lamp/core/Checkout/Promotion.php. A stored promotion quote: the code and
 * the discount it earned, at the moment it was quoted.
 */
export class Promotion {
  constructor(
    public readonly code: string,
    public readonly discountCents: number,
  ) {}

  toArray(): { code: string; discount_cents: number } {
    return { code: this.code, discount_cents: this.discountCents };
  }

  /** Returns null on any shape mismatch rather than trusting an old/corrupt journey-state row. */
  static fromArray(stored: Record<string, unknown> | null | undefined): Promotion | null {
    if (stored === null || stored === undefined) return null;
    if (typeof stored.code !== 'string' || typeof stored.discount_cents !== 'number') return null;
    return new Promotion(stored.code, stored.discount_cents);
  }
}
