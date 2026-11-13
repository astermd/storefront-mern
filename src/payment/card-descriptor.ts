import { CardBrand, CardBrandValue } from './card-brand';
import { PaymentCredential } from './payment-credential';

/**
 * Never includes the card number —
 * a presentation-safe summary (brand, last four, expiry) for a receipt or an order record. The
 * one exception to "the credential is the source" is a token: the storefront never saw that card, so
 * the expiry comes from the provider.
 */
export class CardDescriptor {

  private constructor(
    public readonly brand: CardBrandValue | null,
    public readonly lastFour: string,
    public readonly expiryMonth: string,
    public readonly expiryYear: string,
  ) {}

  /**
   * Brand is detected from the number; `fallback` is used only when the prefix has no answer — never
   * for the last four/expiry, which come straight from buyer input. `fallbackLastFour` is the
   * provider's, used only when the credential carries no number of its own (a Stripe token).
   */
  static fromCredential(
    credential: PaymentCredential,
    fallback: CardBrandValue | null = null,
    fallbackExpiry: string | null = null,
    fallbackLastFour: string | null = null,
  ): CardDescriptor {
    const brand = CardBrand.fromNumber(credential.number ?? '') ?? fallback;
    const own = credential.lastFour();
    const lastFour = own !== '' ? own : fallbackLastFour !== null && /^\d{4}$/.test(fallbackLastFour) ? fallbackLastFour : '';

    // A token collected in the provider's own fields carries no expiry, and rendering it as `00/00`
    // would assert a date nobody supplied. The provider's reading (`MM/YY`) is the only one there is.
    const month = credential.expiryMonth ?? '';
    const reading = /^(\d{1,2})\/(\d{2,4})$/.exec(fallbackExpiry ?? '');
    if (month === '' && reading !== null) {
      return new CardDescriptor(brand, lastFour, reading[1], reading[2]);
    }

    return new CardDescriptor(brand, lastFour, month, credential.expiryYear ?? '');
  }

  /** Omits the `type` key entirely when brand is null (never guesses); always includes `exp` as `MM/YY`. */
  toArray(): Record<string, string> {
    const year = this.expiryYear.length === 4 ? this.expiryYear.slice(2) : this.expiryYear;
    // `last_4` is omitted rather than sent empty when nothing supplied one.
    const out: Record<string, string> = {
      ...(this.lastFour === '' ? {} : { last_4: this.lastFour }),
      exp: `${this.expiryMonth.padStart(2, '0')}/${year.padStart(2, '0')}`,
    };
    if (this.brand !== null) {
      out.type = this.brand;
    }
    return out;
  }
}
