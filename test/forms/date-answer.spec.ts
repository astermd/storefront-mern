import { DateAnswer } from '../../src/forms/date-answer';

describe('DateAnswer', () => {
  it('converts MM/DD/YYYY to ISO, month first', () => {
    expect(DateAnswer.iso('03/04/1990')).toBe('1990-03-04');
  });

  it('tolerates whitespace around the slashes', () => {
    expect(DateAnswer.iso('3 / 4 / 1990')).toBe('1990-03-04');
  });

  it('passes an already-ISO value through unchanged', () => {
    expect(DateAnswer.iso('1990-03-04')).toBe('1990-03-04');
  });

  it('returns null for a date that does not exist rather than rolling it forward', () => {
    expect(DateAnswer.iso('02/31/1990')).toBeNull();
    expect(DateAnswer.iso('1990-02-31')).toBeNull();
  });

  it('returns null for garbage input', () => {
    expect(DateAnswer.iso('not a date')).toBeNull();
    expect(DateAnswer.iso('')).toBeNull();
  });

  it('recognises a real leap day', () => {
    expect(DateAnswer.iso('02/29/2000')).toBe('2000-02-29');
  });

  it('rejects a leap day on a non-leap year', () => {
    expect(DateAnswer.iso('02/29/1990')).toBeNull();
  });
});
