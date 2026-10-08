import { CheckoutChampCardType } from '../../../src/payment/checkout-champ/checkout-champ-card-type';

describe('CheckoutChampCardType.brandFor', () => {
  it('maps case-insensitively, trimmed', () => {
    expect(CheckoutChampCardType.brandFor('VISA')).toBe('visa');
    expect(CheckoutChampCardType.brandFor(' visa ')).toBe('visa');
    expect(CheckoutChampCardType.brandFor('Master Card')).toBe('mastercard');
    expect(CheckoutChampCardType.brandFor('American Express')).toBe('amex');
  });

  it('never guesses on the sandbox\'s fake TESTCARD value', () => {
    expect(CheckoutChampCardType.brandFor('TESTCARD')).toBeNull();
  });

  it('returns null for anything absent or non-string', () => {
    expect(CheckoutChampCardType.brandFor(null)).toBeNull();
    expect(CheckoutChampCardType.brandFor('')).toBeNull();
    expect(CheckoutChampCardType.brandFor(7)).toBeNull();
  });
});
