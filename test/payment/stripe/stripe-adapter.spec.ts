import { CouponGateway } from '../../../src/emr/coupon-gateway';
import { NullCouponGateway } from '../../../src/emr/null-coupon-gateway';
import { STRATEGY_TOKENIZATION } from '../../../src/payment/adapter-capabilities';
import { Buyer } from '../../../src/payment/buyer';
import { CaptureRequest } from '../../../src/payment/capture-request';
import { CardBrand } from '../../../src/payment/card-brand';
import { OrderEnvelope } from '../../../src/payment/order-envelope';
import { OrderLine } from '../../../src/payment/order-line';
import { OrderSearch } from '../../../src/payment/order-search';
import { PaymentCredential } from '../../../src/payment/payment-credential';
import { PlacementOutcome } from '../../../src/payment/placement-outcome';
import { PromotionQuote } from '../../../src/payment/promotion-quote';
import { SettlementMode, SettlementModeValue } from '../../../src/payment/settlement-mode';
import { StripeAdapter } from '../../../src/payment/stripe/stripe-adapter';
import { StripeApiFactory } from '../../../src/payment/stripe/stripe-api-factory';
import { StripeCredentials } from '../../../src/payment/stripe/stripe-credentials';
import { OperatorLog } from '../../../src/support/operator-log';
import { FakeStripeTransport } from '../../support/fake-stripe-transport';

/**
 * The Stripe adapter against Stripe's documented response shapes.
 *
 * The bodies below are built from Stripe's API reference rather than recorded from the wire;
 * `docs/INTEGRATION-NOTES.md` says so, and a test-mode recording should replace them the first time
 * one is made. Request parameters are what Stripe receives, so every scalar is a string.
 */
const PRODUCT = '6a6c202cadc82ad3598f48af';
const VARIANT = '6a6c5d5a62f043873a8afe2d';
const PLAN = '6adf4668a103373c607b85a1';
const COUPON = '6a01b2c3d4e5f6a7b8c9d0f9';
const CHANNEL = '6acf1d207e507866cd5c453d';
const PI = 'pi_3QxSemaA1b2C3d4E';

/** A coupon gateway that prices every code at $10 off, or answers what it is given. */
class FixedCoupons implements CouponGateway {
  constructor(private readonly answer: PromotionQuote | null = null) {}

  async quote(code: string): Promise<PromotionQuote> {
    return this.answer ?? PromotionQuote.accepted(code, 1000, COUPON);
  }

  available(): boolean {
    return true;
  }
}

let transport: FakeStripeTransport;

beforeEach(() => {
  transport = new FakeStripeTransport();
});

function adapter(coupons: CouponGateway = new NullCouponGateway()): StripeAdapter {
  return new StripeAdapter(
    new StripeCredentials('sk_test_secret', 'pk_test_publishable'),
    new StripeApiFactory(transport),
    new OperatorLog('/dev/null'),
    coupons,
    CHANNEL,
    'https://shop.example.com/checkout/confirm/',
  );
}

function line(kind = 'rx', plan: string | null = null, price = 12000): OrderLine {
  return new OrderLine('tirzepatide', 'Tirzepatide (5mg/mL)', 'price_1Tirz', 'prod_tirz', price, 1, kind, PRODUCT, VARIANT, plan);
}

function envelope(
  options: { lines?: OrderLine[]; settlement?: SettlementModeValue; followOn?: boolean; code?: string | null; couponId?: string | null; discountCents?: number; attribution?: Record<string, unknown> } = {},
): OrderEnvelope {
  const lines = options.lines ?? [line()];
  const subtotal = lines.reduce((sum, l) => sum + l.lineTotalCents(), 0);
  const discount = options.discountCents ?? 0;

  return new OrderEnvelope(
    lines,
    new Buyer('Ada', 'Lovelace', 'ada@example.com', '2125551234', '350 5th Avenue', 'New York', 'NY', '10118'),
    subtotal,
    discount,
    subtotal - discount,
    'USD',
    options.code ?? null,
    options.attribution ?? {},
    '123e4567-e89b-12d3-a456-426614174000',
    '203.0.113.7',
    'probe/1.0',
    'idem-1',
    'tirzepatide',
    options.settlement ?? SettlementMode.Capture,
    options.couponId ?? null,
    options.followOn ?? false,
  );
}

function paymentIntent(status: string, amount = 12000, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PI,
    object: 'payment_intent',
    status,
    amount,
    currency: 'usd',
    livemode: false,
    customer: 'cus_VWTGV3w2nz1PqB',
    client_secret: `${PI}_secret_abc`,
    payment_method: {
      id: 'pm_1Card',
      object: 'payment_method',
      type: 'card',
      card: { brand: 'visa', exp_month: 4, exp_year: 2031, last4: '4242' },
    },
    ...extra,
  };
}

function customerList(data: Record<string, unknown>[]): Record<string, unknown> {
  return { object: 'list', data, has_more: false, url: '/v1/customers' };
}

function queueNoCustomer(): void {
  transport.queue(200, customerList([]));
  transport.queue(200, { id: 'cus_New1', object: 'customer', email: 'ada@example.com' });
}

const token = (): PaymentCredential => PaymentCredential.token('ctoken_1Abc');
const saved = (): PaymentCredential => PaymentCredential.stored({ customer: 'cus_VWTGV3w2nz1PqB', payment_method: 'pm_1Card' });

describe('StripeAdapter', () => {
  it("tokenizes in provider-hosted fields and publishes only the publishable key", () => {
    const capabilities = adapter().capabilities();

    expect(capabilities.providerCategory).toBe('stripe');
    expect(capabilities.credentialStrategy).toBe(STRATEGY_TOKENIZATION);
    expect(capabilities.rendersOwnCardFields()).toBe(false);
    expect(capabilities.supportsClientAction).toBe(true);
    expect(capabilities.supportsAuthorizeCapture).toBe(true);
    expect(capabilities.clientConfig.publishable_key).toBe('pk_test_publishable');
    expect(JSON.stringify(capabilities.clientConfig)).not.toContain('sk_test_secret');
  });

  it('offers promotions only when the EMR can price them', () => {
    expect(adapter().capabilities().supportsPromotions).toBe(false);
    expect(adapter(new FixedCoupons()).capabilities().supportsPromotions).toBe(true);
  });

  it('places a succeeded payment and keeps the customer and card for the next charge', async () => {
    queueNoCustomer();
    transport.queue(200, paymentIntent('succeeded'));

    const outcome = await adapter().place(envelope(), token());

    expect(outcome.isPlaced()).toBe(true);
    expect(outcome.reference).toBe(PI);
    expect(outcome.settlement).toBe(SettlementMode.Capture);
    expect(outcome.providerCardBrand).toBe(CardBrand.Visa);
    expect(outcome.providerCardExpiry).toBe('04/31');
    expect(outcome.reusableCredential?.isReusable()).toBe(true);
    expect(outcome.reusableCredential?.handle).toEqual({ customer: 'cus_VWTGV3w2nz1PqB', payment_method: 'pm_1Card' });
  });

  it("reuses the buyer's existing customer rather than duplicating it", async () => {
    transport.queue(200, customerList([{ id: 'cus_Existing', object: 'customer' }]));
    transport.queue(200, paymentIntent('succeeded'));

    await adapter().place(envelope(), token());

    expect(transport.calls()).toEqual(['GET /v1/customers', 'POST /v1/payment_intents']);
    expect(transport.params(0)).toEqual({ email: 'ada@example.com', limit: '1' });
    expect(transport.params(1).customer).toBe('cus_Existing');
  });

  it('creates a customer for a new buyer, with their contact details', async () => {
    queueNoCustomer();
    transport.queue(200, paymentIntent('succeeded'));

    await adapter().place(envelope(), token());

    expect(transport.calls()).toEqual(['GET /v1/customers', 'POST /v1/customers', 'POST /v1/payment_intents']);
    const customer = transport.params(1) as { email: string; name: string; address: { line1: string } };
    expect(customer.email).toBe('ada@example.com');
    expect(customer.name).toBe('Ada Lovelace');
    expect(customer.address.line1).toBe('350 5th Avenue');
    expect(transport.params(2).customer).toBe('cus_New1');
  });

  it('writes the PaymentIntent in the contract the EMR reads back', async () => {
    queueNoCustomer();
    transport.queue(200, paymentIntent('succeeded'));

    await adapter().place(envelope({ attribution: { affiliate_id: 'aff-9', utm_source: 'google', gclid: 'xyz' } }), token());

    const body = transport.params(2) as Record<string, any>;
    expect(body.amount).toBe('12000');
    expect(body.currency).toBe('usd');
    expect(body.confirm).toBe('true');
    expect(body.confirmation_token).toBe('ctoken_1Abc');
    expect(body.setup_future_usage).toBe('off_session');
    expect(body.capture_method).toBe('automatic');
    expect(body.allowed_payment_method_types).toEqual(['card']);
    expect(body.automatic_payment_methods).toBeUndefined();
    expect(body.payment_method_types).toBeUndefined();
    expect(body.return_url).toBe('https://shop.example.com/checkout/confirm/');
    expect(body.shipping.address.line1).toBe('350 5th Avenue');
    expect(body.amount_details.line_items).toEqual([{ product_name: 'Tirzepatide (5mg/mL)', unit_cost: '12000', quantity: '1' }]);

    const metadata = body.metadata;
    expect(metadata.astermd_line_items).toBe(JSON.stringify([{ product_id: PRODUCT, variant_id: VARIANT }]));
    expect(metadata.astermd_order_type).toBe('straight_sale');
    expect(metadata.capture_method).toBe('automatic');
    expect(metadata.astermd_session_id).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(metadata.storefront_channel_id).toBe(CHANNEL);
    expect(metadata.astermd_aff).toBe('aff-9');
    expect(metadata.astermd_utm_source).toBe('google');
    expect(metadata.gclid).toBeUndefined();
    expect(metadata.astermd_payment_mode).toBeUndefined();
    expect(metadata.coupon).toBeUndefined();
  });

  it('names a line sold on a plan by the plan alone and makes the order a cycle', async () => {
    queueNoCustomer();
    transport.queue(200, paymentIntent('succeeded', 9900));

    await adapter(new FixedCoupons()).place(envelope({ lines: [line('rx', PLAN, 10900)], code: 'foobar', couponId: COUPON, discountCents: 1000 }), token());

    const body = transport.params(2) as Record<string, any>;
    expect(body.metadata.astermd_line_items).toBe(`[{"plan_id":"${PLAN}"}]`);
    expect(body.metadata.astermd_order_type).toBe('cycle');
    expect(body.metadata.capture_method).toBe('automatic');
    expect(body.metadata.coupon).toBe('foobar');
    expect(body.metadata.astermd_coupon_id).toBe(COUPON);
    expect(body.amount).toBe('9900');
    expect(body.amount_details.discount_amount).toBe('1000');
  });

  it('holds an authorize order with a prescription for the EMR to capture', async () => {
    queueNoCustomer();
    transport.queue(200, paymentIntent('requires_capture'));

    const outcome = await adapter().place(envelope({ settlement: SettlementMode.Authorize }), token());

    const body = transport.params(2) as Record<string, any>;
    expect(body.capture_method).toBe('manual');
    expect(body.metadata.astermd_payment_mode).toBe('pre_auth');
    expect(body.metadata.capture_method).toBe('manual');
    expect(outcome.isPlaced()).toBe(true);
    expect(outcome.isAuthorizedOnly()).toBe(true);
  });

  it('charges at once a hold nobody would capture', async () => {
    // No prescription: the EMR opens no case, so nothing would capture it.
    queueNoCustomer();
    transport.queue(200, paymentIntent('succeeded'));
    await adapter().place(envelope({ lines: [line('otc')], settlement: SettlementMode.Authorize }), token());
    expect(transport.params(2).capture_method).toBe('automatic');

    // An upsell: a second hold on a treatment is never captured automatically.
    transport = new FakeStripeTransport();
    transport.queue(200, paymentIntent('succeeded'));
    await adapter().place(envelope({ settlement: SettlementMode.Authorize, followOn: true }), saved());
    const body = transport.params(0) as Record<string, any>;
    expect(body.capture_method).toBe('automatic');
    expect(body.metadata.astermd_upsell).toBe('1');
  });

  it('charges the saved card for an upsell with the buyer away', async () => {
    transport.queue(200, paymentIntent('succeeded'));

    await adapter().place(envelope({ followOn: true }), saved());

    // No customer lookup: the saved pair is charged as it is.
    expect(transport.calls()).toEqual(['POST /v1/payment_intents']);
    const body = transport.params(0);
    expect(body.customer).toBe('cus_VWTGV3w2nz1PqB');
    expect(body.payment_method).toBe('pm_1Card');
    expect(body.off_session).toBe('true');
    expect(body.setup_future_usage).toBeUndefined();
    expect(body.return_url).toBeUndefined();
  });

  it("declines a refused card with Stripe's own words and the reference", async () => {
    queueNoCustomer();
    transport.queue(402, {
      error: {
        type: 'card_error',
        code: 'card_declined',
        decline_code: 'insufficient_funds',
        message: 'Your card has insufficient funds.',
        payment_intent: paymentIntent('requires_payment_method'),
      },
    });

    const outcome = await adapter().place(envelope(), token());

    expect(outcome.state).toBe(PlacementOutcome.DECLINED);
    expect(outcome.reason).toBe('Your card has insufficient funds.');
    expect(outcome.rawStatus).toBe('insufficient_funds');
    expect(outcome.reference).toBe(PI);
  });

  it('leaves a verification the bank asks for pending, with what the page needs to run it', async () => {
    queueNoCustomer();
    transport.queue(200, paymentIntent('requires_action', 12000, { next_action: { type: 'use_stripe_sdk', use_stripe_sdk: {} } }));

    const outcome = await adapter().place(envelope(), token());

    expect(outcome.state).toBe(PlacementOutcome.PENDING_ACTION);
    expect(outcome.reference).toBe(PI);
    expect(outcome.clientAction).toBe(`${PI}_secret_abc`);
  });

  it('resume reads what the verification came to', async () => {
    transport.queue(200, paymentIntent('succeeded'));
    const placed = await adapter().resume(PI);
    expect(placed.isPlaced()).toBe(true);
    expect(transport.calls()).toEqual([`GET /v1/payment_intents/${PI}`]);

    transport.queue(200, paymentIntent('requires_payment_method', 12000, { last_payment_error: { message: 'We are unable to authenticate your payment method.' } }));
    const declined = await adapter().resume(PI);
    expect(declined.state).toBe(PlacementOutcome.DECLINED);
    expect(declined.reason).toBe('We are unable to authenticate your payment method.');
  });

  it('resume that cannot reach Stripe stays pending rather than declining', async () => {
    transport.queueFailure(new Error('Could not connect to Stripe.'));

    const outcome = await adapter().resume(PI);

    expect(outcome.state).toBe(PlacementOutcome.PENDING_ACTION);
    expect(outcome.clientAction).toBeNull();
  });

  it('refuses to resume a reference that is not a PaymentIntent, without calling Stripe', async () => {
    const outcome = await adapter().resume('order_123');

    expect(outcome.rawStatus).toBe('invalid_reference');
    expect(transport.requests).toEqual([]);
  });

  it('gives each attempt its own Stripe idempotency key, and a retry reuses it', async () => {
    const keys: (string | null)[] = [];
    for (const attempt of ['ctoken_A', 'ctoken_A', 'ctoken_B']) {
      transport = new FakeStripeTransport();
      transport.queue(200, customerList([{ id: 'cus_Existing' }]));
      transport.queue(200, paymentIntent('succeeded'));
      await adapter().place(envelope(), PaymentCredential.token(attempt));
      keys.push(transport.header(1, 'Idempotency-Key'));
    }

    expect(keys[0]).not.toBeNull();
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).not.toBe(keys[2]);
  });

  it('never charges a card itself', async () => {
    const outcome = await adapter().place(envelope(), PaymentCredential.card('4242424242424242', '04', '2031', '123'));

    expect(outcome.rawStatus).toBe('credential_unusable');
    expect(transport.requests).toEqual([]);
  });

  it('refuses an order the EMR could not map before Stripe is called', async () => {
    const unmapped = new OrderLine('mask', 'Mask', 'price_1Mask', 'prod_mask', 1500, 1);
    expect((await adapter().place(envelope({ lines: [unmapped] }), token())).rawStatus).toBe('line_unmapped');

    const many = Array.from({ length: 8 }, () => line());
    expect((await adapter().place(envelope({ lines: many }), token())).rawStatus).toBe('too_many_lines');

    expect(transport.requests).toEqual([]);
  });

  it('releases the key for a request Stripe refused, but not for an unanswered one', async () => {
    queueNoCustomer();
    transport.queue(400, { error: { type: 'invalid_request_error', message: 'Invalid currency.' } });
    expect((await adapter().place(envelope(), token())).rawStatus).toBe('api_error');

    transport = new FakeStripeTransport();
    transport.queue(200, customerList([{ id: 'cus_Existing' }]));
    transport.queueFailure(new Error('Timed out.'));
    expect((await adapter().place(envelope(), token())).rawStatus).toBe('transport_error');
  });

  it('refuses to capture, leaving it to the EMR', async () => {
    const outcome = await adapter().capture(new CaptureRequest(PI));

    expect(outcome.isCaptured()).toBe(false);
    expect(outcome.reason).toBe('settled_by_emr');
    expect(transport.requests).toEqual([]);
  });

  it("counts only this channel's payments in an order search", async () => {
    transport.queue(200, {
      object: 'list',
      url: '/v1/payment_intents',
      has_more: false,
      data: [
        paymentIntent('succeeded', 12000, { id: 'pi_Ours', created: 1793170990, metadata: { storefront_channel_id: CHANNEL } }),
        paymentIntent('succeeded', 12000, { id: 'pi_Renewal', created: 1793170991, metadata: { astermd_suborder_id: 'x' } }),
      ],
    });

    const result = await adapter().searchOrders(OrderSearch.between(new Date('2026-10-28T00:00:00Z'), new Date('2026-10-28T23:59:59Z')));

    expect(result.ok).toBe(true);
    expect(result.orders.map((o) => o.reference)).toEqual(['pi_Ours']);
    expect(result.orders[0].isCharged).toBe(true);
    expect(result.orders[0].isTest).toBe(true);
    expect(transport.params(0).limit).toBe('100');
  });

  it('reports an unreachable order search as a failure, not an empty result', async () => {
    transport.queueFailure(new Error('Timed out.'));

    const result = await adapter().searchOrders(OrderSearch.between(new Date('2026-10-28T00:00:00Z'), new Date('2026-10-28T23:59:59Z')));

    expect(result.ok).toBe(false);
  });

  it('pings with a one-row read and names the mode', async () => {
    transport.queue(200, { object: 'list', data: [], has_more: false, url: '/v1/payment_intents' });

    expect(await adapter().ping()).toEqual({ ok: true, detail: 'Stripe answered (test mode).' });
  });

  describe('discount codes', () => {
    it('refuses a code that no longer applies before Stripe is called', async () => {
      const refused = new FixedCoupons(PromotionQuote.rejected('foobar', 'denied', 'The coupon has expired'));

      const outcome = await adapter(refused).place(envelope({ code: 'foobar', couponId: COUPON, discountCents: 1000 }), token());

      expect(outcome.rawStatus).toBe('promotion_repriced');
      expect(outcome.reason).toBe('The coupon has expired');
      expect(transport.requests).toEqual([]);
    });

    it('refuses a code whose discount changed before Stripe is called', async () => {
      const outcome = await adapter(new FixedCoupons()).place(envelope({ code: 'foobar', couponId: COUPON, discountCents: 2000 }), token());

      expect(outcome.rawStatus).toBe('promotion_repriced');
      expect(transport.requests).toEqual([]);
    });

    it('does not turn the buyer away when the coupon service cannot answer', async () => {
      queueNoCustomer();
      transport.queue(200, paymentIntent('succeeded', 11000));

      const outcome = await adapter(new FixedCoupons(PromotionQuote.rejected('foobar', 'unavailable'))).place(envelope({ code: 'foobar', couponId: COUPON, discountCents: 1000 }), token());

      expect(outcome.isPlaced()).toBe(true);
    });

    it('prices a code through the EMR', async () => {
      const quote = await adapter(new FixedCoupons()).quotePromotion(envelope(), 'foobar');

      expect(quote.accepted).toBe(true);
      expect(quote.discountCents).toBe(1000);
      expect(quote.reference).toBe(COUPON);
    });
  });
});
