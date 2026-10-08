import { CardBrand, CardBrandValue } from '../card-brand';

/**
 * Ported from storefront-lamp/core/Payment/CheckoutChamp/CheckoutChampCardType.php. Maps the
 * provider's own `cardType` response field (a value the storefront never sent — distinct from the
 * buyer-typed number's prefix-derived brand) onto this port's shared `CardBrandValue`.
 */
export class CheckoutChampCardType {
  private static readonly BRANDS: Record<string, CardBrandValue> = {
    visa: CardBrand.Visa,
    mastercard: CardBrand.Mastercard,
    'master card': CardBrand.Mastercard,
    amex: CardBrand.Amex,
    'american express': CardBrand.Amex,
    discover: CardBrand.Discover,
    diners: CardBrand.DinersClub,
    'diners club': CardBrand.DinersClub,
    jcb: CardBrand.Jcb,
  };

  /** The sandbox's `'TESTCARD'` value is not a real scheme and must not guess — returns `null`, like any other unrecognised string. */
  static brandFor(cardType: unknown): CardBrandValue | null {
    if (typeof cardType !== 'string') return null;
    return CheckoutChampCardType.BRANDS[cardType.toLowerCase().trim()] ?? null;
  }
}
