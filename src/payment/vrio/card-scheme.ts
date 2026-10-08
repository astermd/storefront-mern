import { CardBrand, CardBrandValue } from '../card-brand';

/**
 * Ported from storefront-lamp/core/Payment/Vrio/CardScheme.php. Vrio's own numeric card-type
 * codes, mapped to/from this port's shared `CardBrandValue`.
 */
export class CardScheme {
  static readonly MASTERCARD = 1;
  static readonly VISA = 2;
  static readonly DISCOVER = 3;
  static readonly AMEX = 4;

  /** Visa is the fallback for anything unrecognised (including Diners Club/JCB, which Vrio has no code for). */
  static codeFor(cardNumber: string): number {
    const brand = CardBrand.fromNumber(cardNumber);
    if (brand === CardBrand.Mastercard) return CardScheme.MASTERCARD;
    if (brand === CardBrand.Amex) return CardScheme.AMEX;
    if (brand === CardBrand.Discover) return CardScheme.DISCOVER;
    return CardScheme.VISA;
  }

  static brandFor(code: number | null): CardBrandValue | null {
    switch (code) {
      case CardScheme.MASTERCARD:
        return CardBrand.Mastercard;
      case CardScheme.VISA:
        return CardBrand.Visa;
      case CardScheme.DISCOVER:
        return CardBrand.Discover;
      case CardScheme.AMEX:
        return CardBrand.Amex;
      default:
        return null;
    }
  }
}
