import { inspect } from 'node:util';
import { StripeCredentials } from '../../../src/payment/stripe/stripe-credentials';

describe('StripeCredentials', () => {
  it('builds credentials from the synced config', () => {
    const credentials = StripeCredentials.fromChannelConfig({
      integration_name: 'Stripe',
      api_endpoint: 'https://api.stripe.com/',
      api_key: 'sk_test_secret',
      publishable_key: 'pk_test_publishable',
    });

    expect(credentials.secretKey()).toBe('sk_test_secret');
    expect(credentials.publishableKey).toBe('pk_test_publishable');
    expect(credentials.apiBase).toBe('https://api.stripe.com');
  });

  it("treats an empty endpoint as Stripe's default", () => {
    const credentials = StripeCredentials.fromChannelConfig({ api_key: 'sk_test_secret', publishable_key: 'pk_test_publishable' });

    expect(credentials.apiBase).toBeNull();
  });

  it.each([[{ publishable_key: 'pk_test_x' }], [{ api_key: 'sk_test_x' }]])('refuses either key missing at construction (%j)', (config) => {
    expect(() => StripeCredentials.fromChannelConfig(config)).toThrow(/no (api_key|publishable_key)/);
  });

  it('never shows the secret key in a dump or an encoding', () => {
    const credentials = new StripeCredentials('sk_test_secret', 'pk_test_publishable');

    expect(inspect(credentials)).not.toContain('sk_test_secret');
    expect(JSON.stringify(credentials)).not.toContain('sk_test_secret');
    expect(JSON.stringify(credentials)).toContain('pk_test_publishable');
  });
});
