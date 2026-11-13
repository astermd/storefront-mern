import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StripeApiFactory } from '../../../src/payment/stripe/stripe-api-factory';
import { StripeCredentials } from '../../../src/payment/stripe/stripe-credentials';
import { StripeWireLog } from '../../../src/payment/stripe/stripe-wire-log';
import { FakeStripeTransport } from '../../support/fake-stripe-transport';

/** One line per call, the SDK's behaviour unchanged. */
describe('StripeWireLog', () => {
  const credentials = () => StripeCredentials.fromChannelConfig({ api_key: 'sk_test_wirelog', publishable_key: 'pk_test_wirelog' });

  function setup() {
    const file = join(mkdtempSync(join(tmpdir(), 'stripe-wire-')), 'stripe-wire.log');
    const transport = new FakeStripeTransport();
    const stripe = new StripeApiFactory(new StripeWireLog(transport, file)).create(credentials());
    const lines = () => (existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
    return { transport, stripe, lines };
  }

  it("writes each call as one line with the request and Stripe's answer, and hands the SDK the same answer", async () => {
    const { transport, stripe, lines } = setup();
    transport.queue(200, { id: 'cus_1', object: 'customer', email: 'ada@example.com' });

    const customer = await stripe.customers.create({ email: 'ada@example.com', name: 'Ada' });

    expect(customer.id).toBe('cus_1');
    const [entry] = lines();
    expect(lines()).toHaveLength(1);
    expect(entry.request.method).toBe('POST');
    expect(entry.request.url).toContain('/v1/customers');
    expect(entry.request.params).toEqual({ email: 'ada@example.com', name: 'Ada' });
    // Verbatim, so the call can be replayed by hand: the key is written as sent.
    expect(JSON.stringify(entry.request.headers)).toContain('sk_test_wirelog');
    expect(entry.response.status).toBe(200);
    expect(entry.response.body).toMatchObject({ id: 'cus_1' });
    expect(typeof entry.ms).toBe('number');
  });

  it('writes a call that never reached Stripe, and still fails it', async () => {
    const { transport, stripe, lines } = setup();
    transport.queueFailure(new Error('connect ECONNREFUSED'));

    await expect(stripe.customers.list({ limit: 1 })).rejects.toThrow();
    expect(lines()[0].response.transport_error).toContain('ECONNREFUSED');
  });

  it("keeps Stripe's own errors as errors the adapter reads", async () => {
    const { transport, stripe, lines } = setup();
    transport.queue(402, { error: { type: 'card_error', code: 'card_declined', message: 'Your card was declined.' } });

    await expect(stripe.paymentIntents.create({ amount: 100, currency: 'usd' })).rejects.toMatchObject({ type: 'StripeCardError', code: 'card_declined' });
    expect(lines()[0].response).toMatchObject({ status: 402, body: { error: { code: 'card_declined' } } });
  });
});
