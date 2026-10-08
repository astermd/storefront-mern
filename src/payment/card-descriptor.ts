import { CardBrand, CardBrandValue } from './card-brand';
import { PaymentCredential } from './payment-credential';

/**
 * Ported from storefront-lamp/core/Payment/CardDescriptor.php. Never includes the card number —
 * a presentation-safe summary (brand, last four, expiry) for a receipt or an order record.
 */
export class CardDescriptor {
  private static readonly BIN_LENGTH = 6;

  private constructor(
    public readonly brand: CardBrandValue | null,
    public readonly lastFour: string,
    public readonly expiryMonth: string,
    public readonly expiryYear: string,
  ) {}

  /** Brand is detected from the number; `fallback` is used only when the prefix has no answer — never for the bin/expiry, which come straight from buyer input. */
  static fromCredential(credential: PaymentCredential, fallback: CardBrandValue | null = null): CardDescriptor {
    const brand = CardBrand.fromNumber(credential.number ?? '') ?? fallback;
    return new CardDescriptor(brand, credential.lastFour(), credential.expiryMonth ?? '', credential.expiryYear ?? '');
  }

  /** Omits the `type` key entirely when brand is null (never guesses); always includes `exp` as `MM/YY`. */
  toArray(): Record<string, string> {
    const year = this.expiryYear.length === 4 ? this.expiryYear.slice(2) : this.expiryYear;
    const out: Record<string, string> = {
      last4: this.lastFour,
      exp: `${this.expiryMonth.padStart(2, '0')}/${year.padStart(2, '0')}`,
    };
    if (this.brand !== null) {
      out.type = this.brand;
    }
    return out;
  }
}
