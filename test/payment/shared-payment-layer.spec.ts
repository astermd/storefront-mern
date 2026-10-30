import { CheckoutAttempt } from '../../src/checkout/checkout-attempt';
import { ConsentRecord } from '../../src/checkout/consent-record';
import { Promotion } from '../../src/checkout/promotion';
import { JourneyState } from '../../src/journey/journey-state';
import { Boundary } from '../../src/observability/boundary';
import { AdapterCapabilities, SCOPE_LINE_ITEM, STRATEGY_TOKENIZATION, SURFACE_PROVIDER_HOSTED } from '../../src/payment/adapter-capabilities';
import { CardDescriptor } from '../../src/payment/card-descriptor';
import { NullPaymentAdapter } from '../../src/payment/null-payment-adapter';
import { PaymentCredential } from '../../src/payment/payment-credential';
import { PlacementOutcome } from '../../src/payment/placement-outcome';
import { PromotionQuote } from '../../src/payment/promotion-quote';

describe('shared payment layer additions', () => {
  it('AdapterCapabilities defaults clientConfig to empty and supportsClientAction to false', () => {
    const caps = new AdapterCapabilities('x', false, SCOPE_LINE_ITEM, STRATEGY_TOKENIZATION, SURFACE_PROVIDER_HOSTED, [], [], 'p');
    expect(caps.clientConfig).toEqual({});
    expect(caps.supportsClientAction).toBe(false);
    expect(caps.rendersOwnCardFields()).toBe(false);
  });

  it('NullPaymentAdapter declares no client action and declines a resume', async () => {
    const adapter = new NullPaymentAdapter();
    expect(adapter.capabilities().supportsClientAction).toBe(false);
    const outcome = await adapter.resume('ref');
    expect(outcome.state).toBe(PlacementOutcome.DECLINED);
    expect(outcome.rawStatus).toBe('no_provider_configured');
  });

  it('a pending outcome carries the client action in memory only: it is never encoded for storage', () => {
    const outcome = PlacementOutcome.pendingAction('pi_1', '', 'requires_action', 'secret_value');
    expect(outcome.clientAction).toBe('secret_value');
    expect(JSON.stringify(CheckoutAttempt.encodeOutcome(outcome))).not.toContain('secret_value');
    expect(CheckoutAttempt.decodeOutcome(CheckoutAttempt.encodeOutcome(outcome))?.clientAction).toBeNull();
  });

  it('a promotion keeps the quote reference through journey state, and drops an empty one', () => {
    const quote = PromotionQuote.accepted('SAVE', 1000, 'coupon_1');
    expect(quote.reference).toBe('coupon_1');
    expect(PromotionQuote.accepted('SAVE', 1000).reference).toBeNull();

    const stored = new Promotion('SAVE', 1000, quote.reference).toArray();
    expect(stored).toEqual({ code: 'SAVE', discount_cents: 1000, reference: 'coupon_1' });
    expect(Promotion.fromArray(stored)?.reference).toBe('coupon_1');
    expect(new Promotion('SAVE', 1000).toArray()).toEqual({ code: 'SAVE', discount_cents: 1000 });
  });

  it('a token credential takes its expiry from the provider, not a made-up 00/00', () => {
    const token = PaymentCredential.token('ctoken_1');
    expect(CardDescriptor.fromCredential(token, null, '04/29').toArray().exp).toBe('04/29');
    expect(CardDescriptor.fromCredential(PaymentCredential.card('4111111111111111', '12', '2030', '123'), null, '04/29').toArray().exp).toBe('12/30');
  });

  it('journey state round-trips a pending payment and drops a partial one', () => {
    const pending = { reference: 'pi_1', idempotency_key: 'k', claimed_at: '2026-01-01T00:00:00Z' };
    const state = JourneyState.fromArray({ pendingPayment: pending }, null, null);
    expect(state.toArray().pendingPayment).toEqual(pending);

    const partial = JourneyState.fromArray({ pendingPayment: { reference: 'pi_1', idempotency_key: '', claimed_at: 'x' } }, null, null);
    expect(partial.pendingPayment).toBeNull();
  });

  it('a stored consent record is rebuilt, and a malformed one is refused', () => {
    const record = new ConsentRecord('terms', true, 'v1', 'copy', 'at');
    expect(ConsentRecord.fromArray(record.toArray())?.toArray()).toEqual(record.toArray());
    expect(ConsentRecord.fromArray({ key: 'terms' })).toBeNull();
  });

  it('names the resume boundary', () => {
    expect(Boundary.ProviderResume).toBe('provider.resume');
  });
});
