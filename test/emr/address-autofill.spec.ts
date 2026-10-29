import { EmrAddressAutofill } from '../../src/emr/emr-address-autofill';
import { NullAddressAutofill } from '../../src/emr/null-address-autofill';
import { apiError, capturedLog, fakeClients, response } from '../support/fake-emr-client';

/**
 * Ported from storefront-lamp/tests/Emr/AddressAutofillTest.php. The EMR's answers below are the
 * shapes it gives: suggestions as formatted strings with no ZIP and from any country, and a
 * verifier whose `formatted_address` carries the ZIP.
 */
function autofill(verification: Record<string, jest.Mock>) {
  const captured = capturedLog();
  return { autofill: new EmrAddressAutofill(fakeClients({ verification }), captured.log), captured };
}

describe('EmrAddressAutofill', () => {
  it('only US suggestions are offered', async () => {
    const { autofill: gateway } = autofill({
      autofillAddress: jest.fn().mockResolvedValue(
        response([
          { unique_id: 'a', address: '1600 Amphitheatre Parkway, Mountain View, CA, USA', main_text: '1600 Amphitheatre Parkway' },
          { unique_id: 'b', address: '1600 Amphitheatre Road, Mount Lonarch VIC, Australia', main_text: '1600 Amphitheatre Road' },
          { unique_id: 'c', address: '1600 Amphitheatre Trail, Jaffrey, NH, USA', main_text: '1600 Amphitheatre Trail' },
        ]),
      ),
    });

    expect(await gateway.suggest('1600 Amphitheatre')).toEqual([
      { address: '1600 Amphitheatre Parkway, Mountain View, CA, USA', main_text: '1600 Amphitheatre Parkway' },
      { address: '1600 Amphitheatre Trail, Jaffrey, NH, USA', main_text: '1600 Amphitheatre Trail' },
    ]);
  });

  it('a suggestion is resolved through the verifier for its ZIP', async () => {
    const { autofill: gateway } = autofill({
      verifyAddress: jest.fn().mockResolvedValue(response({ valid: false, formatted_address: '350 5th Avenue, New York, NY 10118-0110, USA' })),
    });

    expect(await gateway.resolve('350 5th Ave, New York, NY, USA')).toEqual({
      address_line: '350 5th Avenue',
      city: 'New York',
      territory: 'NY',
      postal_code: '10118',
    });
  });

  it('without the verifier the suggestion itself fills all but the ZIP', async () => {
    const { autofill: gateway } = autofill({ verifyAddress: jest.fn().mockRejectedValue(apiError(403)) });

    expect(await gateway.resolve('350 5th Ave, New York, NY, USA')).toEqual({
      address_line: '350 5th Ave',
      city: 'New York',
      territory: 'NY',
      postal_code: '',
    });
  });

  it('a refused lookup is null and an info line that names no address', async () => {
    const { autofill: gateway, captured } = autofill({ autofillAddress: jest.fn().mockRejectedValue(apiError(403, 'refused 350 5th Ave')) });

    expect(await gateway.suggest('350 5th Ave')).toBeNull();
    expect(captured.lines).toHaveLength(1);
    expect(captured.lines[0]).toMatchObject({ level: 'info', event: 'address_autofill.unavailable', context: { call: 'autofill', status: 403 } });
    expect(JSON.stringify(captured.lines)).not.toContain('350 5th');
  });

  it('the null port can never ask', async () => {
    const gateway = new NullAddressAutofill();

    expect(await gateway.suggest()).toBeNull();
    expect(await gateway.resolve()).toBeNull();
  });
});
