import { Buyer } from '../../../src/payment/buyer';
import { OrderEnvelope } from '../../../src/payment/order-envelope';
import { OrderLine } from '../../../src/payment/order-line';
import { PaymentCredential } from '../../../src/payment/payment-credential';
import { CheckoutChampPayload } from '../../../src/payment/checkout-champ/checkout-champ-payload';

function buyer(): Buyer {
  return new Buyer('Jane', 'Doe', 'jane@example.test', '5551234567', '1 Main St', 'Metropolis', 'NY', '10001');
}

function order(lines: OrderLine[]): OrderEnvelope {
  return new OrderEnvelope(lines, buyer(), 12000, 0, 12000, 'USD', null, {}, null, null, null, 'idem-1', 'anchor');
}

describe('CheckoutChampPayload.campaignOf', () => {
  it('resolves the one campaign shared by every chargeable line', () => {
    const lines = [new OrderLine('a', 'A', 'camp-1', 'item-1', 5000, 1), new OrderLine('b', 'B', 'camp-1', 'item-2', 2000, 1)];
    expect(CheckoutChampPayload.campaignOf(lines)).toBe('camp-1');
  });

  it('refuses when lines disagree about the campaign', () => {
    const lines = [new OrderLine('a', 'A', 'camp-1', 'item-1', 5000, 1), new OrderLine('b', 'B', 'camp-2', 'item-2', 2000, 1)];
    expect(CheckoutChampPayload.campaignOf(lines)).toBeNull();
  });

  it('refuses on zero chargeable lines', () => {
    expect(CheckoutChampPayload.campaignOf([])).toBeNull();
  });
});

describe('CheckoutChampPayload numbering', () => {
  it('numbers only chargeable lines, leaving no gap when an unmapped line is interleaved', () => {
    const lines = [
      new OrderLine('a', 'A', 'camp-1', 'item-1', 5000, 2),
      new OrderLine('free', 'Free', null, null, 0, 1),
      new OrderLine('b', 'B', 'camp-1', 'item-2', 2000, 1),
    ];

    const body = CheckoutChampPayload.forOrder(order(lines), PaymentCredential.card('4111111111111111', '01', '2030', '123'), 'ref-1');

    expect(body.product1_id).toBe('item-1');
    expect(body.product1_qty).toBe(2);
    expect(body.product1_price).toBe('50.00');
    expect(body.product2_id).toBe('item-2');
    expect(body.product3_id).toBeUndefined();
  });

  it('sets forceQA only when explicitly asked', () => {
    const lines = [new OrderLine('a', 'A', 'camp-1', 'item-1', 5000, 1)];
    const credential = PaymentCredential.card('4111111111111111', '01', '2030', '123');

    expect(CheckoutChampPayload.forOrder(order(lines), credential, 'ref-1', true).forceQA).toBe(1);
    expect(CheckoutChampPayload.forOrder(order(lines), credential, 'ref-1', false).forceQA).toBeUndefined();
  });
});

describe('CheckoutChampPayload.paymentFor', () => {
  it('builds a CREDITCARD payment block for a card credential', () => {
    const body = CheckoutChampPayload.paymentFor(PaymentCredential.card('4111111111111111', '01', '2030', '123'));
    expect(body).toEqual({ paySource: 'CREDITCARD', cardNumber: '4111111111111111', cardMonth: '01', cardYear: '2030', cardSecurityCode: '123' });
  });

  it('builds an ACCTONFILE payment block for a stored instrument', () => {
    const body = CheckoutChampPayload.paymentFor(PaymentCredential.stored({ customer_id: '19241' }));
    expect(body).toEqual({ paySource: 'ACCTONFILE', customerId: '19241' });
  });

  it('is empty for anything this provider cannot charge', () => {
    expect(CheckoutChampPayload.paymentFor(PaymentCredential.token('tok_1'))).toEqual({});
    expect(CheckoutChampPayload.paymentFor(PaymentCredential.orderReference('order_1'))).toEqual({});
  });
});
