import { CardScheme } from '../../../src/payment/vrio/card-scheme';

describe('CardScheme', () => {
  it('maps a card number to its Vrio numeric code via the shared CardBrand prefix table', () => {
    expect(CardScheme.codeFor('5500000000000004')).toBe(CardScheme.MASTERCARD);
    expect(CardScheme.codeFor('340000000000009')).toBe(CardScheme.AMEX);
    expect(CardScheme.codeFor('6011000000000004')).toBe(CardScheme.DISCOVER);
    expect(CardScheme.codeFor('4111111111111111')).toBe(CardScheme.VISA);
  });

  it('falls back to Visa for anything Vrio has no code for (Diners Club, JCB, unrecognised)', () => {
    expect(CardScheme.codeFor('30000000000004')).toBe(CardScheme.VISA); // Diners Club
    expect(CardScheme.codeFor('3528000000000007')).toBe(CardScheme.VISA); // JCB
    expect(CardScheme.codeFor('')).toBe(CardScheme.VISA);
  });

  it('maps a provider code back to a brand, or null for anything unrecognised', () => {
    expect(CardScheme.brandFor(1)).toBe('mastercard');
    expect(CardScheme.brandFor(2)).toBe('visa');
    expect(CardScheme.brandFor(3)).toBe('discover');
    expect(CardScheme.brandFor(4)).toBe('amex');
    expect(CardScheme.brandFor(9)).toBeNull();
    expect(CardScheme.brandFor(null)).toBeNull();
  });
});
