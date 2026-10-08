import { CheckoutChampOutcome } from '../../../src/payment/checkout-champ/checkout-champ-outcome';
import { SettlementMode } from '../../../src/payment/settlement-mode';

describe('CheckoutChampOutcome.from', () => {
  it('places an order on {result: SUCCESS, message: object}, reconciling the total and reading back a reusable customer id', () => {
    const outcome = CheckoutChampOutcome.from(
      { result: 'SUCCESS', message: { orderStatus: 'COMPLETE', orderId: 'D6C8C390A7', customerId: 19241, totalAmount: '120.00', cardType: 'VISA' } },
      'D6C8C390A7',
      12000,
    );

    expect(outcome.isPlaced()).toBe(true);
    expect(outcome.rawStatus).toBe('COMPLETE');
    expect(outcome.chargeDiscrepancy).toBeNull();
    expect(outcome.reusableCredential?.handle).toEqual({ customer_id: '19241' });
    expect(outcome.providerCardBrand).toBe('visa');
  });

  it('still places an order on {result: SUCCESS, message: string} — the preauth-success shape with no orderId/total at all', () => {
    const outcome = CheckoutChampOutcome.from({ result: 'SUCCESS', message: 'Card is preauthorized' }, 'ref-1');
    expect(outcome.isPlaced()).toBe(true);
    expect(outcome.rawStatus).toBeNull();
    expect(outcome.reusableCredential).toBeNull();
  });

  it('declines on {result: ERROR, message: string}, showing the message to the buyer verbatim', () => {
    const outcome = CheckoutChampOutcome.from({ result: 'ERROR', message: 'Transaction Declined: Card Declined' }, 'ref-1');
    expect(outcome.isPlaced()).toBe(false);
    expect(outcome.reason).toBe('Transaction Declined: Card Declined');
  });

  it('declines on {result: ERROR, message: object} (a field-validation map), NEVER showing it to the buyer', () => {
    const outcome = CheckoutChampOutcome.from({ result: 'ERROR', message: { shipAddress1: 'is a required field', shipCity: 'is a required field' } }, 'ref-1');
    expect(outcome.isPlaced()).toBe(false);
    expect(outcome.reason).toBe(CheckoutChampOutcome.GENERIC_DECLINE);
  });

  it('declines on a transport failure before even looking at `result`', () => {
    const outcome = CheckoutChampOutcome.from({ curlError: 'timed out' }, 'ref-1');
    expect(outcome.isPlaced()).toBe(false);
    expect(outcome.rawStatus).toBe('transport_error');
  });

  it('reports a charge discrepancy when the settled total differs from what checkout expected', () => {
    const outcome = CheckoutChampOutcome.from({ result: 'SUCCESS', message: { totalAmount: '150.00', discountAmount: '10.00' } }, 'ref-1', 12000);
    expect(outcome.chargeDiscrepancy).toEqual({ expectedCents: 12000, chargedCents: 15000, providerDiscountCents: 1000 });
  });

  it('carries the settlement/preAuthQa flags through to a placed outcome', () => {
    const outcome = CheckoutChampOutcome.from({ result: 'SUCCESS', message: 'Order QA Approved' }, 'ref-1', null, SettlementMode.Authorize, true);
    expect(outcome.settlement).toBe(SettlementMode.Authorize);
    expect(outcome.preAuthQa).toBe(true);
  });
});

describe('CheckoutChampOutcome.capturedFrom', () => {
  it('is true only for a clean {result: SUCCESS}', () => {
    expect(CheckoutChampOutcome.capturedFrom({ result: 'SUCCESS', message: 'Order QA Approved' })).toBe(true);
    expect(CheckoutChampOutcome.capturedFrom({ result: 'ERROR', message: 'No products exist in the order' })).toBe(false);
    expect(CheckoutChampOutcome.capturedFrom({ curlError: 'timed out' })).toBe(false);
  });
});

describe('CheckoutChampOutcome.referenceFrom', () => {
  it('reads orderId from a successful lead response', () => {
    expect(CheckoutChampOutcome.referenceFrom({ result: 'SUCCESS', message: { orderStatus: 'PARTIAL', orderId: 'D6C8C390A7' } })).toBe('D6C8C390A7');
  });

  it('is null when the lead call was rejected', () => {
    expect(CheckoutChampOutcome.referenceFrom({ result: 'ERROR', message: 'First and last name are required fields.' })).toBeNull();
  });
});
