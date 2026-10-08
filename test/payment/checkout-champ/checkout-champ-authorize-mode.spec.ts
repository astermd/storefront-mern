import { CheckoutChampAuthorizeMode } from '../../../src/payment/checkout-champ/checkout-champ-authorize-mode';

describe('CheckoutChampAuthorizeMode.parse', () => {
  it('forgives case and surrounding whitespace', () => {
    expect(CheckoutChampAuthorizeMode.parse('  QA ')).toBe('qa');
    expect(CheckoutChampAuthorizeMode.parse('Preauth')).toBe('preauth');
  });

  it('never guesses on an unrecognised spelling — returns null', () => {
    expect(CheckoutChampAuthorizeMode.parse('pre-auth')).toBeNull();
    expect(CheckoutChampAuthorizeMode.parse('legacy')).toBeNull();
    expect(CheckoutChampAuthorizeMode.parse('')).toBeNull();
    expect(CheckoutChampAuthorizeMode.parse(null)).toBeNull();
    expect(CheckoutChampAuthorizeMode.parse(1)).toBeNull();
  });

  it('only Qa holds the full order amount', () => {
    expect(CheckoutChampAuthorizeMode.holdsTheOrderAmount('qa')).toBe(true);
    expect(CheckoutChampAuthorizeMode.holdsTheOrderAmount('preauth')).toBe(false);
  });
});
