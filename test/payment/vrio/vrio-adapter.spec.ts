import { OperatorLog } from '../../../src/support/operator-log';
import { Buyer } from '../../../src/payment/buyer';
import { CaptureRequest } from '../../../src/payment/capture-request';
import { OrderEnvelope } from '../../../src/payment/order-envelope';
import { OrderLine } from '../../../src/payment/order-line';
import { OrderSearch } from '../../../src/payment/order-search';
import { PaymentCredential } from '../../../src/payment/payment-credential';
import { SettlementMode } from '../../../src/payment/settlement-mode';
import { VrioAdapter } from '../../../src/payment/vrio/vrio-adapter';
import { VrioApiFactory } from '../../../src/payment/vrio/vrio-api-factory';
import { VrioCredentials } from '../../../src/payment/vrio/vrio-credentials';
import { FakeVrioTransport, envelope } from './fake-vrio-transport';

const CREDENTIALS = VrioCredentials.fromChannelConfig({ api_key: 'k1', api_endpoint: 'api.vrio.app', campaign_id: 147, connection_id: 3 });

function buyer(): Buyer {
  return new Buyer('Jane', 'Doe', 'jane@example.test', '5551234567', '1 Main St', 'Metropolis', 'NY', '10001');
}

function chargeableLine(): OrderLine {
  return new OrderLine('semaglutide', 'Semaglutide', 'offer-1', 'item-1', 12000, 1);
}

function order(lines: OrderLine[] = [chargeableLine()], settlement = SettlementMode.Capture): OrderEnvelope {
  return new OrderEnvelope(lines, buyer(), 12000, 0, 12000, 'USD', null, {}, 'session-uuid', '203.0.113.1', 'agent', 'idem-1', 'semaglutide', settlement);
}

function cardCredential(): PaymentCredential {
  return PaymentCredential.card('4111111111111111', '01', '2030', '123');
}

function adapterWith(transport: FakeVrioTransport, shippingProfileId = 1): VrioAdapter {
  return new VrioAdapter(CREDENTIALS, new VrioApiFactory(transport), new OperatorLog('/dev/null'), shippingProfileId);
}

describe('VrioAdapter.place', () => {
  it('places a card order, sending campaign/connection/shipping and the buyer/offer fields', async () => {
    const transport = new FakeVrioTransport([envelope({ order_id: 'v1', response_code: 100, transaction_total: '120.00', order: { status_type_id: 3 } })]);
    const outcome = await adapterWith(transport, 42).place(order(), cardCredential());

    expect(outcome.isPlaced()).toBe(true);
    expect(outcome.reference).toBe('v1');

    const body = transport.paramsOf(0);
    expect(body).toMatchObject({
      campaign_id: 147,
      connection_id: 3,
      shipping_profile_id: 42,
      action: 'process',
      email: 'jane@example.test',
      session_id: 'session-uuid',
      card_number: '4111111111111111',
      card_type_id: 2,
    });
    expect((body.offers as unknown[])[0]).toMatchObject({ offer_id: 'offer-1', item_id: 'item-1' });
  });

  it('sends action=authorize when the order settles as authorize', async () => {
    const transport = new FakeVrioTransport([envelope({ order_id: 'v1', order: {} })]);
    await adapterWith(transport).place(order([chargeableLine()], SettlementMode.Authorize), cardCredential());
    expect(transport.paramsOf(0).action).toBe('authorize');
  });

  it('declines without a wire call when the cart has no chargeable lines', async () => {
    const transport = new FakeVrioTransport([]);
    const outcome = await adapterWith(transport).place(order([new OrderLine('free', 'Free', null, null, 0, 1)]), cardCredential());

    expect(outcome.isPlaced()).toBe(false);
    expect(outcome.rawStatus).toBe('no_chargeable_lines');
    expect(transport.requests).toHaveLength(0);
  });

  it('declines without a wire call when the credential is one this provider cannot charge', async () => {
    const transport = new FakeVrioTransport([]);
    const outcome = await adapterWith(transport).place(order(), PaymentCredential.token('tok_1'));

    expect(outcome.isPlaced()).toBe(false);
    expect(outcome.rawStatus).toBe('credential_unusable');
    expect(transport.requests).toHaveLength(0);
  });

  it('declines cleanly, never leaking the exception message, when the transport throws', async () => {
    const transport = new FakeVrioTransport([]); // empty queue -> FakeVrioTransport itself throws
    const outcome = await adapterWith(transport).place(order(), cardCredential());

    expect(outcome.isPlaced()).toBe(false);
    expect(outcome.rawStatus).toBe('exception');
    expect(outcome.reason).toBe('We could not complete your payment. Please check your card details and try again.');
  });
});

describe('VrioAdapter.quotePromotion', () => {
  it('rejects an empty code without a wire call', async () => {
    const transport = new FakeVrioTransport([]);
    const quote = await adapterWith(transport).quotePromotion(order(), '  ');
    expect(quote.accepted).toBe(false);
    expect(quote.reason).toBe('empty');
    expect(transport.requests).toHaveLength(0);
  });

  it('accepts and sums the discount across every valid offer', async () => {
    const transport = new FakeVrioTransport([
      envelope({
        success: true,
        offers: [
          { discount_details: { discount_code_valid: true }, offer_total_discount: 5 },
          { discount_details: { discount_code_valid: false }, offer_total_discount: 2 },
        ],
      }),
    ]);
    const quote = await adapterWith(transport).quotePromotion(order(), 'SAVE5');
    expect(quote.accepted).toBe(true);
    expect(quote.discountCents).toBe(700);
  });

  it('rejects when no offer reports the code as valid', async () => {
    const transport = new FakeVrioTransport([envelope({ success: true, offers: [{ discount_details: { discount_code_valid: false }, offer_total_discount: 5 }] })]);
    const quote = await adapterWith(transport).quotePromotion(order(), 'BAD');
    expect(quote.accepted).toBe(false);
    expect(quote.reason).toBe('invalid');
  });
});

describe('VrioAdapter.searchOrders', () => {
  it('maps matching-campaign rows and drops foreign-campaign rows from the reported total', async () => {
    const transport = new FakeVrioTransport([
      envelope({
        success: true,
        orders: [
          { order_id: 1, campaign_id: 147, status_type_id: 3, date_created: '2026-01-01 00:00:00', order_discount: '5.00' },
          { order_id: 2, campaign_id: 999, status_type_id: 3 },
        ],
        total: 2,
      }),
    ]);

    const result = await adapterWith(transport).searchOrders(OrderSearch.between(new Date('2026-01-01'), new Date('2026-01-02')));

    expect(result.ok).toBe(true);
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].reference).toBe('1');
    expect(result.orders[0].discountCents).toBe(500);
    expect(result.reportedTotal).toBe(1);
  });

  it('reports failure, not an empty success, when the provider rejects the search', async () => {
    // A non-null top-level `error` key is what makes the real client's own envelope wrapping
    // report `success: false` — a raw `success` field means nothing to it.
    const transport = new FakeVrioTransport([envelope({ error: { message: 'campaign not found' } })]);
    const result = await adapterWith(transport).searchOrders(OrderSearch.between(new Date('2026-01-01'), new Date('2026-01-02')));
    expect(result.ok).toBe(false);
    expect(result.failureReason).toBe('rejected');
  });
});

describe('VrioAdapter.capture', () => {
  it('fails without a wire call when no reference is given', async () => {
    const transport = new FakeVrioTransport([]);
    const outcome = await adapterWith(transport).capture(new CaptureRequest('  '));
    expect(outcome.isCaptured()).toBe(false);
    expect(outcome.reason).toBe('missing_reference');
    expect(transport.requests).toHaveLength(0);
  });

  it('captures on a successful envelope', async () => {
    const transport = new FakeVrioTransport([envelope({ success: true })]);
    const outcome = await adapterWith(transport).capture(new CaptureRequest('ref-1'));
    expect(outcome.isCaptured()).toBe(true);
    expect(outcome.reference).toBe('ref-1');
  });

  it('reports the provider error code as the failure reason on a refused capture', async () => {
    const transport = new FakeVrioTransport([envelope({ error: { code: 'order_unauthorized', message: 'Order has not been authorized.' } })]);
    const outcome = await adapterWith(transport).capture(new CaptureRequest('ref-1'));
    expect(outcome.isCaptured()).toBe(false);
    expect(outcome.reason).toBe('order_unauthorized');
  });
});

describe('VrioAdapter.ping', () => {
  it('reports ok with the campaign/connection detail on success', async () => {
    const transport = new FakeVrioTransport([envelope({ success: true, campaign_items: [{ id: 1 }, { id: 2 }] })]);
    const result = await adapterWith(transport).ping();
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('campaign 147');
    expect(result.detail).toContain('2 items');
    expect(result.detail).toContain('connection 3');
  });

  it('reports not ok when the provider rejects the ping', async () => {
    const transport = new FakeVrioTransport([envelope({ error: { message: 'Invalid API key' } })]);
    const result = await adapterWith(transport).ping();
    expect(result.ok).toBe(false);
    expect(result.detail).toBe('Invalid API key');
  });
});

describe('VrioAdapter client action (`[14.22]`)', () => {
  it('declares no client action, so its challenge stops the checkout', () => {
    expect(adapterWith(new FakeVrioTransport([])).capabilities().supportsClientAction).toBe(false);
  });

  it('answers resume() with a decline rather than throwing, and reaches nothing', async () => {
    const transport = new FakeVrioTransport([]);
    const outcome = await adapterWith(transport).resume('ref-1');

    expect(outcome.state).toBe('declined');
    expect(outcome.reference).toBe('ref-1');
    expect(outcome.rawStatus).toBe('resume_unsupported');
  });
});
