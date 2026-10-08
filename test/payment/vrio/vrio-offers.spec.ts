import { Buyer } from '../../../src/payment/buyer';
import { OrderEnvelope } from '../../../src/payment/order-envelope';
import { OrderLine } from '../../../src/payment/order-line';
import { VrioOffers } from '../../../src/payment/vrio/vrio-offers';

function buyer(): Buyer {
  return new Buyer('Jane', 'Doe', 'jane@example.test', '5551234567', '1 Main St', 'Metropolis', 'NY', '10001');
}

function order(lines: OrderLine[], promotionCode: string | null = null): OrderEnvelope {
  return new OrderEnvelope(lines, buyer(), 12000, 0, 12000, 'USD', promotionCode, {}, null, null, null, 'idem-1', 'anchor');
}

describe('VrioOffers', () => {
  it('prices every chargeable line for a charge, using the order_offer_quantity key and attaching the promo code to every line', () => {
    const lines = [new OrderLine('a', 'A', 'offer-1', 'item-1', 5000, 2), new OrderLine('b', 'B', 'offer-2', 'item-2', 2000, 1)];

    const offers = VrioOffers.forCharge(order(lines, 'SAVE10'));

    expect(offers).toHaveLength(2);
    expect(offers[0]).toMatchObject({ offer_id: 'offer-1', item_id: 'item-1', order_offer_price: '50.00', order_offer_quantity: '2', discount_code: 'SAVE10' });
    expect(offers[1]).toMatchObject({ discount_code: 'SAVE10' });
    expect(offers[0]).toMatchObject({ order_offer_shipping: '0.00', order_offer_upsell: false, parent_offer_id: null, parent_order_id: null });
  });

  it('sends an empty-string discount code on every charged line when there is no promotion', () => {
    const offers = VrioOffers.forCharge(order([new OrderLine('a', 'A', 'offer-1', 'item-1', 5000, 1)]));
    expect(offers[0].discount_code).toBe('');
  });

  it('quotes with the offer_quantity key instead, and no shipping/upsell/parent fields', () => {
    const offers = VrioOffers.forQuote(order([new OrderLine('a', 'A', 'offer-1', 'item-1', 5000, 3)]), 'SAVE10');

    expect(offers[0]).toEqual({ offer_id: 'offer-1', item_id: 'item-1', order_offer_price: '50.00', offer_quantity: '3', discount_code: 'SAVE10' });
  });

  it('skips unmapped lines entirely, on both charge and quote', () => {
    const lines = [new OrderLine('a', 'A', 'offer-1', 'item-1', 5000, 1), new OrderLine('b', 'B', null, null, 0, 1)];
    expect(VrioOffers.forCharge(order(lines))).toHaveLength(1);
    expect(VrioOffers.forQuote(order(lines), 'X')).toHaveLength(1);
  });
});
