/**
 * Ported from storefront-lamp/core/Payment/PromotionQuote.php. What the provider said about one
 * discount code, quoted against the cart about to be charged.
 */
export class PromotionQuote {
  private constructor(
    public readonly code: string,
    public readonly accepted: boolean,
    public readonly discountCents: number,
    public readonly reason: string | null,
    /** The provider's own explanation of a refusal, set only from text known to be about the code — shown to the buyer as given. */
    public readonly notice: string | null = null,
  ) {}

  static accepted(code: string, discountCents: number): PromotionQuote {
    return new PromotionQuote(code, true, Math.max(0, discountCents), null);
  }

  static rejected(code: string, reason: string, notice: string | null = null): PromotionQuote {
    return new PromotionQuote(code, false, 0, reason, notice);
  }
}
