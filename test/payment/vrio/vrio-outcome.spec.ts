import { SettlementMode } from '../../../src/payment/settlement-mode';
import { VrioOutcome } from '../../../src/payment/vrio/vrio-outcome';

describe('VrioOutcome.from', () => {
  it('places an approved order, reconciling the charged total and reading back a reusable credential + card brand', () => {
    const outcome = VrioOutcome.from(
      {
        success: true,
        message: '',
        data: {
          order_id: 12345,
          response_code: 100,
          transaction_total: '120.00',
          customer_id: 555,
          order: {
            status_type_id: 3,
            customer_card_id: 'card123',
            customer_card: { card_type_id: 2 },
            order_discount: null,
          },
        },
      },
      12000,
    );

    expect(outcome.isPlaced()).toBe(true);
    expect(outcome.reference).toBe('12345');
    expect(outcome.rawStatus).toBe('3');
    expect(outcome.chargeDiscrepancy).toBeNull();
    expect(outcome.reusableCredential?.handle).toEqual({ customer_id: '555', customer_card_id: 'card123' });
    expect(outcome.providerCardBrand).toBe('visa');
  });

  it('reports a charge discrepancy when the settled total differs from what checkout expected', () => {
    const outcome = VrioOutcome.from(
      { success: true, data: { order_id: '1', transaction_total: '150.00', order: { status_type_id: 3, order_discount: '10.00' } } },
      12000,
    );

    expect(outcome.isPlaced()).toBe(true);
    expect(outcome.chargeDiscrepancy).not.toBeNull();
    expect(outcome.chargeDiscrepancy?.expectedCents).toBe(12000);
    expect(outcome.chargeDiscrepancy?.chargedCents).toBe(15000);
    expect(outcome.chargeDiscrepancy?.differenceCents()).toBe(3000);
    expect(outcome.chargeDiscrepancy?.providerDiscountCents).toBe(1000);
  });

  it('declines a rejected order, reading the transaction nested at data.error.transaction', () => {
    const outcome = VrioOutcome.from({
      success: false,
      message: 'Card was declined',
      data: { error: { message: 'Card was declined', transaction: { order_id: '999', response_code: 200 } } },
    });

    expect(outcome.isPlaced()).toBe(false);
    expect(outcome.reference).toBe('999');
    expect(outcome.reason).toBe('Card was declined');
  });

  it('declines a stored-credential refusal before ever looking for a reference, using the dedicated buyer message', () => {
    const outcome = VrioOutcome.from({ success: false, data: { error: { code: 'customer_card_invalid' } } });

    expect(outcome.isPlaced()).toBe(false);
    expect(outcome.reference).toBeNull();
    expect(outcome.reason).toBe(VrioOutcome.STORED_CREDENTIAL_DECLINE);
    expect(outcome.rawStatus).toBe('credential_refused');
  });

  it('reports a pending action (3DS/challenge) on response_code 101 with a redirect', () => {
    const outcome = VrioOutcome.from({
      success: true,
      data: { order_id: '777', response_code: 101, post_data: 'https://redirect.example/challenge' },
    });

    expect(outcome.state).toBe('pending_action');
    expect(outcome.reference).toBe('777');
    expect(outcome.actionUrl).toBe('https://redirect.example/challenge');
    expect(outcome.rawStatus).toBe('101');
  });

  it('declines outright on a transport failure, before touching anything else', () => {
    const outcome = VrioOutcome.from({ curlError: 'Connection timed out' });

    expect(outcome.isPlaced()).toBe(false);
    expect(outcome.reason).toBe(VrioOutcome.GENERIC_DECLINE);
    expect(outcome.rawStatus).toBe('transport_error');
  });

  it('declines when no reference can be found anywhere in the envelope', () => {
    const outcome = VrioOutcome.from({ success: true, data: {} });

    expect(outcome.isPlaced()).toBe(false);
    expect(outcome.rawStatus).toBe('no_reference');
  });

  it('always declines a terminal order status, regardless of settlement mode', () => {
    const authorize = VrioOutcome.from({ success: true, data: { order_id: '888', order: { status_type_id: 2 } } }, null, SettlementMode.Authorize);
    const capture = VrioOutcome.from({ success: true, data: { order_id: '888', order: { status_type_id: 2 } } }, null, SettlementMode.Capture);

    expect(authorize.isPlaced()).toBe(false);
    expect(capture.isPlaced()).toBe(false);
  });

  it('treats a null status as placed under Authorize but declined under Capture — the one branch settlement changes', () => {
    const envelope = { success: true, data: { order_id: '900', order: {} } };

    expect(VrioOutcome.from(envelope, null, SettlementMode.Authorize).isPlaced()).toBe(true);
    expect(VrioOutcome.from(envelope, null, SettlementMode.Capture).isPlaced()).toBe(false);
  });

  it('never mints a reusable credential from a mismatched or half-present pair', () => {
    const outcome = VrioOutcome.from({ success: true, data: { order_id: '1', order: { status_type_id: 3, customer_card_id: 'card1' } } });
    expect(outcome.reusableCredential).toBeNull();
  });
});
