import { StripeApiFactory } from '../../../src/payment/stripe/stripe-api-factory';
import { StripeCredentials } from '../../../src/payment/stripe/stripe-credentials';
import { StripeRefusingTransport } from '../../../src/payment/stripe/stripe-refusing-transport';

describe('StripeRefusingTransport', () => {
  it('refuses to send, naming the seam to stub instead', async () => {
    await expect(new StripeRefusingTransport().makeRequest()).rejects.toThrow(/test environment/);
  });

  it('fails a call made through a client built with it, rather than reaching Stripe', async () => {
    const stripe = new StripeApiFactory(new StripeRefusingTransport()).create(new StripeCredentials('sk_test_secret', 'pk_test_publishable'));

    await expect(stripe.paymentIntents.list({ limit: 1 })).rejects.toThrow();
  });
});

describe('StripeApiFactory', () => {
  it("pins the API version the EMR reads payments with, which is the package's own", async () => {
    const { default: Stripe } = await import('stripe');

    expect(StripeApiFactory.API_VERSION).toBe('2026-09-30.endive');
    expect(StripeApiFactory.API_VERSION).toBe(Stripe.API_VERSION);
  });
});
