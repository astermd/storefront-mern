/**
 * Ported from storefront-lamp/core/Payment/CardBrand.php. Prefix-based brand detection —
 * unrecognised returns null (not a guess).
 *
 * Order matters: JCB is tested before Diners Club, since JCB's 3528-3589 range overlaps Diners'
 * `35` neighborhood.
 */
export type CardBrandValue = 'amex' | 'visa' | 'mastercard' | 'discover' | 'diners_club' | 'jcb';

export class CardBrand {
  static readonly Amex: CardBrandValue = 'amex';
  static readonly Visa: CardBrandValue = 'visa';
  static readonly Mastercard: CardBrandValue = 'mastercard';
  static readonly Discover: CardBrandValue = 'discover';
  static readonly DinersClub: CardBrandValue = 'diners_club';
  static readonly Jcb: CardBrandValue = 'jcb';

  static fromNumber(number: string): CardBrandValue | null {
    const digits = number.replace(/\D/g, '');
    const n2 = Number(digits.slice(0, 2));
    const n3 = Number(digits.slice(0, 3));
    const n4 = Number(digits.slice(0, 4));

    if (digits.startsWith('4')) return CardBrand.Visa;
    if ((n2 >= 51 && n2 <= 55) || (n4 >= 2221 && n4 <= 2720)) return CardBrand.Mastercard;
    if (n2 === 34 || n2 === 37) return CardBrand.Amex;
    // JCB tested before Diners Club — 3528-3589 overlaps Diners' 35 neighborhood.
    if (n4 >= 3528 && n4 <= 3589) return CardBrand.Jcb;
    if ((n3 >= 300 && n3 <= 305) || n4 === 3095 || n2 === 36 || n2 === 38 || n2 === 39) return CardBrand.DinersClub;
    if (digits.startsWith('6011') || n2 === 65 || (n4 >= 6440 && n4 <= 6499)) return CardBrand.Discover;

    return null;
  }
}
