/**
 * Ported from storefront-lamp/core/Checkout/Promotion.php. A stored promotion quote: the code and
 * the discount it earned, at the moment it was quoted.
 *
 * `reference` is the pricing system's own id for the code when it gave one
 * (`PromotionQuote.reference`), kept with the code so the order can name the discount the way that
 * system will look it up again.
 */
export class Promotion {
  constructor(
    public readonly code: string,
    public readonly discountCents: number,
    public readonly reference: string | null = null,
  ) {}

  toArray(): { code: string; discount_cents: number; reference?: string } {
    const stored: { code: string; discount_cents: number; reference?: string } = { code: this.code, discount_cents: this.discountCents };
    if (this.reference !== null) {
      stored.reference = this.reference;
    }
    return stored;
  }

  /** Returns null on any shape mismatch rather than trusting an old/corrupt journey-state row. */
  static fromArray(stored: Record<string, unknown> | null | undefined): Promotion | null {
    if (stored === null || stored === undefined) return null;
    if (typeof stored.code !== 'string' || typeof stored.discount_cents !== 'number') return null;
    const reference = stored.reference;
    return new Promotion(stored.code, stored.discount_cents, typeof reference === 'string' && reference !== '' ? reference : null);
  }
}
