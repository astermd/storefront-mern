/**
 * Ported from storefront-lamp/core/Checkout/CardNumber.php. Deliberately no Luhn check — that
 * would break provider sandbox test cards (e.g. `1444444444444440`). The provider has the last
 * word on card validity (`[13.28]`).
 */
export class CardNumber {
  private static readonly SHORTEST = 13;
  private static readonly LONGEST = 19;

  static problem(number: string): string | null {
    const digits = number.replace(/\D/g, '');

    if (digits === '') return 'Enter the card number.';
    if (digits.length < CardNumber.SHORTEST || digits.length > CardNumber.LONGEST) {
      return 'Enter a card number between 13 and 19 digits.';
    }

    return null;
  }
}
