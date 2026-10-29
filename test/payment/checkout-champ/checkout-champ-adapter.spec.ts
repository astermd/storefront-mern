import { OperatorLog } from '../../../src/support/operator-log';
import { Buyer } from '../../../src/payment/buyer';
import { CaptureRequest } from '../../../src/payment/capture-request';
import { OrderEnvelope } from '../../../src/payment/order-envelope';
import { OrderLine } from '../../../src/payment/order-line';
import { OrderSearch } from '../../../src/payment/order-search';
import { PaymentCredential } from '../../../src/payment/payment-credential';
import { SettlementMode } from '../../../src/payment/settlement-mode';
import { CheckoutChampAdapter } from '../../../src/payment/checkout-champ/checkout-champ-adapter';
import { CheckoutChampApiFactory } from '../../../src/payment/checkout-champ/checkout-champ-api-factory';
import { CheckoutChampAuthorizeMode, CheckoutChampAuthorizeModeValue } from '../../../src/payment/checkout-champ/checkout-champ-authorize-mode';
import { CheckoutChampCredentials } from '../../../src/payment/checkout-champ/checkout-champ-credentials';
import { envelope, FakeCheckoutChampTransport } from './fake-checkout-champ-transport';

const CREDENTIALS = CheckoutChampCredentials.fromChannelConfig({ api_username: 'u1', api_password: 'p1', api_endpoint: 'api.checkoutchamp.com' });

function buyer(): Buyer {
  return new Buyer('Jane', 'Doe', 'jane@example.test', '5551234567', '1 Main St', 'Metropolis', 'NY', '10001');
}

function chargeableLine(): OrderLine {
  return new OrderLine('semaglutide', 'Semaglutide', 'camp-1', 'item-1', 12000, 1);
}

function order(lines: OrderLine[] = [chargeableLine()], settlement = SettlementMode.Capture): OrderEnvelope {
  return new OrderEnvelope(lines, buyer(), 12000, 0, 12000, 'USD', null, {}, null, null, null, 'idem-1', 'semaglutide', settlement);
}

function cardCredential(): PaymentCredential {
  return PaymentCredential.card('4111111111111111', '01', '2030', '123');
}

function adapterWith(transport: FakeCheckoutChampTransport, authorizeMode: CheckoutChampAuthorizeModeValue = CheckoutChampAuthorizeMode.Qa): CheckoutChampAdapter {
  return new CheckoutChampAdapter(CREDENTIALS, new CheckoutChampApiFactory(transport), new OperatorLog('/dev/null'), 'https://storefront.test/checkout/', authorizeMode);
}

const LEAD_OK = envelope({ result: 'SUCCESS', message: { orderStatus: 'PARTIAL', orderId: 'D6C8C390A7' } });
const ORDER_OK = envelope({ result: 'SUCCESS', message: { orderStatus: 'COMPLETE', orderId: 'D6C8C390A7', totalAmount: '120.00' } });

describe('CheckoutChampAdapter.place', () => {
  it('opens a lead then bills the order, in that order, on a capture settlement', async () => {
    const transport = new FakeCheckoutChampTransport([LEAD_OK, ORDER_OK]);
    const outcome = await adapterWith(transport).place(order(), cardCredential());

    expect(outcome.isPlaced()).toBe(true);
    expect(outcome.reference).toBe('D6C8C390A7');
    expect(transport.pathOf(0)).toBe('/leads/import/');
    expect(transport.pathOf(1)).toBe('/order/import/');
    expect(transport.paramsOf(1).forceQA).toBeUndefined();
  });

  it('holds the full order amount via forceQA when settling as authorize under Qa mode', async () => {
    const transport = new FakeCheckoutChampTransport([LEAD_OK, ORDER_OK]);
    const outcome = await adapterWith(transport, CheckoutChampAuthorizeMode.Qa).place(order([chargeableLine()], SettlementMode.Authorize), cardCredential());

    expect(transport.pathOf(1)).toBe('/order/import/');
    expect(transport.paramsOf(1).forceQA).toBe('1');
    expect(outcome.preAuthQa).toBe(true);
  });

  it('uses /order/preauth/ instead when settling as authorize under Preauth mode, with no forceQA', async () => {
    const transport = new FakeCheckoutChampTransport([LEAD_OK, ORDER_OK]);
    const outcome = await adapterWith(transport, CheckoutChampAuthorizeMode.Preauth).place(order([chargeableLine()], SettlementMode.Authorize), cardCredential());

    expect(transport.pathOf(1)).toBe('/order/preauth/');
    expect(transport.paramsOf(1).forceQA).toBeUndefined();
    expect(outcome.preAuthQa).toBe(false);
  });

  it('declines without any wire call when the cart has no chargeable lines', async () => {
    const transport = new FakeCheckoutChampTransport([]);
    const outcome = await adapterWith(transport).place(order([new OrderLine('free', 'Free', null, null, 0, 1)]), cardCredential());
    expect(outcome.rawStatus).toBe('no_chargeable_lines');
    expect(transport.requests).toHaveLength(0);
  });

  it('declines without any wire call when the credential cannot be charged', async () => {
    const transport = new FakeCheckoutChampTransport([]);
    const outcome = await adapterWith(transport).place(order(), PaymentCredential.token('tok_1'));
    expect(outcome.rawStatus).toBe('credential_unusable');
    expect(transport.requests).toHaveLength(0);
  });

  it('refuses before the wire when the cart\'s lines disagree about the campaign', async () => {
    const transport = new FakeCheckoutChampTransport([]);
    const lines = [new OrderLine('a', 'A', 'camp-1', 'item-1', 5000, 1), new OrderLine('b', 'B', 'camp-2', 'item-2', 2000, 1)];
    const outcome = await adapterWith(transport).place(order(lines), cardCredential());
    expect(outcome.rawStatus).toBe('campaign_unresolved');
    expect(transport.requests).toHaveLength(0);
  });

  it('declines without ever calling the billing endpoint when the lead was not created', async () => {
    const transport = new FakeCheckoutChampTransport([envelope({ result: 'ERROR', message: 'First and last name are required fields.' })]);
    const outcome = await adapterWith(transport).place(order(), cardCredential());
    expect(outcome.rawStatus).toBe('lead_not_created');
    expect(transport.requests).toHaveLength(1);
  });

  it('declines cleanly, never leaking the exception message, when the transport throws', async () => {
    const transport = new FakeCheckoutChampTransport([]);
    const outcome = await adapterWith(transport).place(order(), cardCredential());
    expect(outcome.isPlaced()).toBe(false);
    expect(outcome.reason).toBe('We could not complete your payment. Please check your card details and try again.');
  });
});

describe('CheckoutChampAdapter.quotePromotion / searchOrders', () => {
  const coupon = (message: unknown, result = 'SUCCESS') => envelope({ result, message });

  it('declares promotion support so the control is shown', () => {
    expect(adapterWith(new FakeCheckoutChampTransport([])).capabilities().supportsPromotions).toBe(true);
  });

  it('quotes a code against the same numbered lines the billing call sends, with the shipping country and state', async () => {
    const transport = new FakeCheckoutChampTransport([coupon({ priceDiscount: 36, shipDiscount: 0 })]);
    const lines = [new OrderLine('a', 'A', 'camp-1', 'item-1', 12000, 1), new OrderLine('b', 'B', 'camp-1', 'item-2', 9000, 2)];

    await adapterWith(transport).quotePromotion(order(lines), ' SAVE30 ');

    expect(transport.pathOf(0)).toBe('/order/coupon/');
    expect(transport.paramsOf(0)).toMatchObject({
      campaignId: 'camp-1',
      couponCode: 'SAVE30',
      shipCountry: 'US',
      shipState: 'NY',
      product1_id: 'item-1',
      product1_price: '120.00',
      product2_id: 'item-2',
      product2_qty: '2',
      product2_price: '90.00',
    });
  });

  it('quotes a price discount in dollars as cents', async () => {
    const quote = await adapterWith(new FakeCheckoutChampTransport([coupon({ priceDiscount: 0.08, shipDiscount: 0 })])).quotePromotion(order(), 'COUPON30');

    expect(quote.accepted).toBe(true);
    expect(quote.code).toBe('COUPON30');
    expect(quote.discountCents).toBe(8);
  });

  it('refuses a zero discount as invalid, because an unknown code answers exactly that, with no notice', async () => {
    const quote = await adapterWith(new FakeCheckoutChampTransport([coupon({ priceDiscount: 0, shipDiscount: 0 })])).quotePromotion(order(), 'NOSUCHCODE');

    expect(quote.accepted).toBe(false);
    expect(quote.reason).toBe('invalid');
    expect(quote.notice).toBeNull();
  });

  it('does not count a shipping discount towards the quote', async () => {
    const quote = await adapterWith(new FakeCheckoutChampTransport([coupon({ priceDiscount: 5, shipDiscount: 2.5 })])).quotePromotion(order(), 'SAVE5');

    expect(quote.discountCents).toBe(500);
  });

  it('passes on the provider\'s own reason when it names the coupon', async () => {
    const quote = await adapterWith(new FakeCheckoutChampTransport([coupon('Coupon is expired', 'ERROR')])).quotePromotion(order(), 'OLDCODE');

    expect(quote.accepted).toBe(false);
    expect(quote.reason).toBe('invalid');
    expect(quote.notice).toBe('Coupon is expired');
  });

  it('keeps a refusal about the request itself away from the buyer', async () => {
    const quote = await adapterWith(new FakeCheckoutChampTransport([coupon('No products exist in the order', 'ERROR')])).quotePromotion(order(), 'SAVE10');

    expect(quote.reason).toBe('invalid');
    expect(quote.notice).toBeNull();
  });

  it('degrades to a rejected code, never a throw, when the provider cannot be reached', async () => {
    const quote = await adapterWith(new FakeCheckoutChampTransport([])).quotePromotion(order(), 'SAVE10');

    expect(quote.accepted).toBe(false);
    expect(quote.reason).toBe('unavailable');
  });

  it('never reaches the provider for an empty code or a cart with no single campaign', async () => {
    const transport = new FakeCheckoutChampTransport([]);
    const adapter = adapterWith(transport);

    expect((await adapter.quotePromotion(order(), '  ')).reason).toBe('empty');
    expect((await adapter.quotePromotion(order([new OrderLine('a', 'A', 'camp-1', 'item-1', 5000, 1), new OrderLine('b', 'B', 'camp-2', 'item-2', 2000, 1)]), 'SAVE10')).reason).toBe('no_offers');
    expect(transport.requests).toHaveLength(0);
  });

  it('sends the quoted code on the billing call, and no coupon parameter without one', async () => {
    const withCode = new FakeCheckoutChampTransport([LEAD_OK, ORDER_OK]);
    const discounted = new OrderEnvelope([chargeableLine()], buyer(), 12000, 1200, 10800, 'USD', 'SAVE10', {}, null, null, null, 'idem-1', 'semaglutide', SettlementMode.Capture);
    await adapterWith(withCode).place(discounted, cardCredential());
    expect(withCode.paramsOf(1).couponCode).toBe('SAVE10');

    const without = new FakeCheckoutChampTransport([LEAD_OK, ORDER_OK]);
    await adapterWith(without).place(order(), cardCredential());
    expect(without.paramsOf(1).couponCode).toBeUndefined();
  });

  it('sends a channel-mapped free add-on as its own line at 0.00 on the same campaign', async () => {
    const transport = new FakeCheckoutChampTransport([LEAD_OK, ORDER_OK]);

    await adapterWith(transport).place(order([chargeableLine(), new OrderLine('syringe', 'Syringe', 'camp-1', 'item-9', 0, 1)]), cardCredential());

    expect(transport.paramsOf(1)).toMatchObject({ campaignId: 'camp-1', product2_id: 'item-9', product2_qty: '1', product2_price: '0.00' });
  });

  it('always reports order search as unsupported, deliberately, despite orderQuery existing', async () => {
    const transport = new FakeCheckoutChampTransport([]);
    const result = await adapterWith(transport).searchOrders(OrderSearch.between(new Date('2026-01-01'), new Date('2026-01-02')));
    expect(result.ok).toBe(false);
    expect(result.failureReason).toBe('unsupported');
    expect(transport.requests).toHaveLength(0);
  });
});

describe('CheckoutChampAdapter.capture', () => {
  it('fails without a wire call when no reference is given', async () => {
    const transport = new FakeCheckoutChampTransport([]);
    const outcome = await adapterWith(transport).capture(new CaptureRequest(''));
    expect(outcome.reason).toBe('missing_reference');
    expect(transport.requests).toHaveLength(0);
  });

  it('settles via /order/qa/ with no lines at all under Qa mode', async () => {
    const transport = new FakeCheckoutChampTransport([envelope({ result: 'SUCCESS', message: 'Order QA Approved' })]);
    const outcome = await adapterWith(transport, CheckoutChampAuthorizeMode.Qa).capture(new CaptureRequest('ref-1'));

    expect(outcome.isCaptured()).toBe(true);
    expect(transport.pathOf(0)).toBe('/order/qa/');
    expect(transport.paramsOf(0)).toMatchObject({ orderId: 'ref-1', action: 'APPROVE' });
  });

  it('is refused before the wire under Preauth mode when the capture request carries no lines', async () => {
    const transport = new FakeCheckoutChampTransport([]);
    const outcome = await adapterWith(transport, CheckoutChampAuthorizeMode.Preauth).capture(new CaptureRequest('ref-1'));
    expect(outcome.reason).toBe('lines_unusable');
    expect(transport.requests).toHaveLength(0);
  });

  it('resends the lines via /order/import/ under Preauth mode', async () => {
    const transport = new FakeCheckoutChampTransport([envelope({ result: 'SUCCESS', message: { orderStatus: 'COMPLETE' } })]);
    const outcome = await adapterWith(transport, CheckoutChampAuthorizeMode.Preauth).capture(new CaptureRequest('ref-1', [chargeableLine()]));

    expect(outcome.isCaptured()).toBe(true);
    expect(transport.pathOf(0)).toBe('/order/import/');
    expect(transport.paramsOf(0)).toMatchObject({ orderId: 'ref-1', campaignId: 'camp-1', product1_id: 'item-1' });
  });

  it('resends the coupon code with the lines on a Preauth settle, and omits it when there is none', async () => {
    const transport = new FakeCheckoutChampTransport([envelope({ result: 'SUCCESS', message: { orderStatus: 'COMPLETE' } }), envelope({ result: 'SUCCESS', message: { orderStatus: 'COMPLETE' } })]);
    const adapter = adapterWith(transport, CheckoutChampAuthorizeMode.Preauth);

    await adapter.capture(new CaptureRequest('ref-1', [chargeableLine()], 'SAVE10'));
    await adapter.capture(new CaptureRequest('ref-1', [chargeableLine()]));

    expect(transport.paramsOf(0).couponCode).toBe('SAVE10');
    expect(transport.paramsOf(1).couponCode).toBeUndefined();
  });

  it('never reports a refused capture as settled', async () => {
    const transport = new FakeCheckoutChampTransport([envelope({ result: 'ERROR', message: 'No products exist in the order' })]);
    const outcome = await adapterWith(transport, CheckoutChampAuthorizeMode.Qa).capture(new CaptureRequest('ref-1'));
    expect(outcome.isCaptured()).toBe(false);
    expect(outcome.reason).toBe('No products exist in the order');
  });

  it('flattens a field-validation-map failure into readable text, unlike the placement path', async () => {
    const transport = new FakeCheckoutChampTransport([envelope({ result: 'ERROR', message: { action: "Not a valid input. Must be in: 'APPROVE', 'DECLINE'" } })]);
    const outcome = await adapterWith(transport, CheckoutChampAuthorizeMode.Qa).capture(new CaptureRequest('ref-1'));
    expect(outcome.reason).toContain('action');
    expect(outcome.reason).toContain("Not a valid input");
  });
});

describe('CheckoutChampAdapter.ping', () => {
  it('reports ok with the login/campaign-count/authorize-mode detail on success', async () => {
    const transport = new FakeCheckoutChampTransport([envelope({ result: 'SUCCESS', message: { data: [{ id: 1 }, { id: 2 }] } })]);
    const result = await adapterWith(transport, CheckoutChampAuthorizeMode.Qa).ping();
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('login u1');
    expect(result.detail).toContain('2 campaign(s)');
    expect(result.detail).toContain('holds the order amount');
  });

  it('reports not ok when the provider rejects the ping', async () => {
    const transport = new FakeCheckoutChampTransport([envelope({ result: 'ERROR', message: 'Invalid credentials' })]);
    const result = await adapterWith(transport).ping();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('rejected: Invalid credentials');
  });
});
