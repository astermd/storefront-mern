import { FormattedAddress } from '../../src/checkout/formatted-address';

/** Ported from storefront-lamp/tests/Checkout/FormattedAddressTest.php. */
describe('FormattedAddress', () => {
  it("the verifier's address fills all four fields with a five-digit ZIP", () => {
    expect(FormattedAddress.parse('350 5th Avenue, New York, NY 10118-0110, USA')).toEqual({
      address_line: '350 5th Avenue',
      city: 'New York',
      territory: 'NY',
      postal_code: '10118',
    });
  });

  it('a suggestion with no ZIP fills everything else', () => {
    expect(FormattedAddress.parse('350 5th Ave, New York, NY, USA')).toEqual({
      address_line: '350 5th Ave',
      city: 'New York',
      territory: 'NY',
      postal_code: '',
    });
  });

  it('a street that holds a comma keeps all of it', () => {
    expect(FormattedAddress.parse('Suite 5, 123 Main St, Springfield, IL 62701, USA')?.address_line).toBe('Suite 5, 123 Main St');
  });

  it('anything outside the US or not in that shape fills nothing', () => {
    expect(FormattedAddress.parse('1600 Amphitheatre Road, Mount Lonarch VIC, Australia')).toBeNull();
    // The state spelled out rather than as its code: not a field the form can take.
    expect(FormattedAddress.parse('350 5th Ave, Brooklyn, New York, USA')).toBeNull();
    expect(FormattedAddress.parse('New York, NY, USA')).toBeNull();
    expect(FormattedAddress.parse('')).toBeNull();
  });

  it('only an address ending in the US counts as one', () => {
    expect(FormattedAddress.isUnitedStates('350 5th Ave, New York, NY, USA')).toBe(true);
    expect(FormattedAddress.isUnitedStates('1 Main St, Austin, TX, United States')).toBe(true);
    expect(FormattedAddress.isUnitedStates('1600 Amphitheatre Parkway, Mountain View, CA 94043, Nice, Hello, Nigeria')).toBe(false);
  });
});
