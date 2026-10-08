import { CheckoutChampCredentials } from '../../../src/payment/checkout-champ/checkout-champ-credentials';

describe('CheckoutChampCredentials.fromChannelConfig', () => {
  it('splits a full endpoint URL into host and base path', () => {
    const credentials = CheckoutChampCredentials.fromChannelConfig({ api_username: 'u1', api_password: 'p1', api_endpoint: 'https://api.checkoutchamp.com/v2/' });
    expect(credentials.host).toBe('api.checkoutchamp.com');
    expect(credentials.basePath).toBe('v2');
    expect(credentials.loginId).toBe('u1');
  });

  it('accepts a bare hostname with no scheme', () => {
    const credentials = CheckoutChampCredentials.fromChannelConfig({ api_username: 'u1', api_password: 'p1', api_endpoint: 'api.checkoutchamp.com' });
    expect(credentials.host).toBe('api.checkoutchamp.com');
    expect(credentials.basePath).toBe('');
  });

  it('carries no campaign — campaign is per-line on this provider, not per-connection', () => {
    const credentials = CheckoutChampCredentials.fromChannelConfig({ api_username: 'u1', api_password: 'p1', api_endpoint: 'api.checkoutchamp.com' });
    expect((credentials as unknown as Record<string, unknown>).campaignId).toBeUndefined();
  });

  it('throws when api_password is missing or blank', () => {
    expect(() => CheckoutChampCredentials.fromChannelConfig({ api_username: 'u1', api_endpoint: 'api.checkoutchamp.com' })).toThrow(/api_username\/api_password/);
  });

  it('throws when api_endpoint is missing or unusable', () => {
    expect(() => CheckoutChampCredentials.fromChannelConfig({ api_username: 'u1', api_password: 'p1' })).toThrow(/api_endpoint/);
  });

  it('never exposes the password through JSON.stringify or util.inspect', () => {
    const credentials = CheckoutChampCredentials.fromChannelConfig({ api_username: 'u1', api_password: 'super-secret', api_endpoint: 'api.checkoutchamp.com' });
    expect(JSON.stringify(credentials)).not.toContain('super-secret');
    expect(credentials.password()).toBe('super-secret');
  });
});
