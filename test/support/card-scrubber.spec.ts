import { CardScrubber } from '../../src/support/card-scrubber';

describe('CardScrubber', () => {
  it('masks a Luhn-valid 16-digit card number, with its separators', () => {
    // 4111 1111 1111 1111 is a well-known Luhn-valid test PAN.
    expect(CardScrubber.scrub('card 4111 1111 1111 1111 charged')).toBe('card [redacted-card] charged');
    expect(CardScrubber.scrub('4111-1111-1111-1111')).toBe('[redacted-card]');
    expect(CardScrubber.scrub('4111111111111111')).toBe('[redacted-card]');
  });

  it('does not mask a Luhn-invalid run of the same length — an ordinary identifier', () => {
    const notACard = '1234567890123456'; // fails Luhn
    expect(CardScrubber.scrub(`order ${notACard} placed`)).toBe(`order ${notACard} placed`);
  });

  it('does not mask a canonical UUID even though its hex digits could pass Luhn by chance', () => {
    const uuid = '11111111-1111-1111-1111-111111111111'; // all-1s: passes Luhn as a bare digit run
    expect(CardScrubber.scrub(`correlation id ${uuid}`)).toBe(`correlation id ${uuid}`);
  });

  it('masks a security code by key adjacency, dropping only the value', () => {
    expect(CardScrubber.scrub('cvv=737')).toBe('cvv=[redacted-card]');
    expect(CardScrubber.scrub('CVC: 123')).toBe('CVC: [redacted-card]');
  });

  it('masks an expiry in MM/YY, MM-YY, and MMYYYY shapes', () => {
    expect(CardScrubber.scrub('ccexp=12/30')).toBe('ccexp=[redacted-card]');
    expect(CardScrubber.scrub('exp: 12-2030')).toBe('exp: [redacted-card]');
    expect(CardScrubber.scrub('exp=122030')).toBe('exp=[redacted-card]');
  });

  it('refuses a 5-digit or 7+-digit run under a sensitive key — some other datum, left whole', () => {
    expect(CardScrubber.scrub('exp=1234567')).toBe('exp=1234567');
  });

  it('does not match a sensitive key that is only the tail of a longer identifier', () => {
    expect(CardScrubber.scrub('regexp=1230')).toBe('regexp=1230');
  });

  it('masks a short group (CVV/expiry) sitting beside a proven PAN in the same run', () => {
    // A gateway echo of "PAN space CVV" as one digit run with no key at all.
    expect(CardScrubber.scrub('4111111111111111 737')).toBe('[redacted-card] [redacted-card]');
  });

  it('leaves short digit groups alone when no PAN was found in the run at all', () => {
    expect(CardScrubber.scrub('737 42')).toBe('737 42');
  });

  it('finds the longest Luhn-valid reading first, matching PAN over two shorter coincidental reads', () => {
    // The full 16 digits are a valid PAN; masking should consume the whole thing once, not twice.
    const masked = CardScrubber.scrub('4111111111111111') as string;
    expect(masked).toBe('[redacted-card]');
  });

  it('recurses into arrays and plain objects, preserving keys and non-string values', () => {
    const input = {
      order_id: 12345,
      note: 'card 4111111111111111 declined',
      nested: { cvv: 'cvv=737', ids: ['4111111111111111', 'not-a-card'] },
    };
    expect(CardScrubber.scrubRecord(input)).toEqual({
      order_id: 12345,
      note: 'card [redacted-card] declined',
      nested: { cvv: 'cvv=[redacted-card]', ids: ['[redacted-card]', 'not-a-card'] },
    });
  });

  it('leaves non-string, non-object values untouched', () => {
    expect(CardScrubber.scrub(42)).toBe(42);
    expect(CardScrubber.scrub(true)).toBe(true);
    expect(CardScrubber.scrub(null)).toBe(null);
  });
});
