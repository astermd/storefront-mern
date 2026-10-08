import { CheckoutEvent } from '@astermd-hq/sdk';
import { AbandonmentClassifier } from '../../src/abandonment/abandonment-classifier';
import { AbandonmentState } from '../../src/abandonment/abandonment-state';
import { JourneyState } from '../../src/journey/journey-state';

function journey(overrides: Partial<JourneyState> = {}): JourneyState {
  const state = new JourneyState();
  Object.assign(state, overrides);
  return state;
}

describe('AbandonmentClassifier', () => {
  const classifier = new AbandonmentClassifier();

  it('returns null for a journey that took no step at all', () => {
    expect(classifier.classify(journey())).toBeNull();
  });

  it('classifies a populated cart with nothing further as cart_abandoned', () => {
    const state = journey({ cart: { lines: [{ slug: 'a', name: 'A', kind: 'otc', emr_product_id: null, parent_slug: null, quantity: 1, unit_price_cents: 100, variant_id: null }], territory: null } });
    expect(classifier.classify(state)).toBe(AbandonmentState.Cart);
  });

  it('classifies a captured lead (opportunityId set) as lead_abandoned even with an empty cart', () => {
    const state = journey({ opportunityId: 'opp-1' });
    expect(classifier.classify(state)).toBe(AbandonmentState.Lead);
  });

  it('classifies an in-progress form as intake_abandoned, deeper than lead or cart', () => {
    const state = journey({ opportunityId: 'opp-1', formStatus: { 'teleform-1': 'in_progress' } });
    expect(classifier.classify(state)).toBe(AbandonmentState.Intake);
  });

  it('classifies a checkout_visited event as checkout_abandoned, deeper than intake', () => {
    const state = journey({ formStatus: { 'teleform-1': 'in_progress' }, emrEvents: [CheckoutEvent.CheckoutVisited] });
    expect(classifier.classify(state)).toBe(AbandonmentState.Checkout);
  });

  it('classifies an order_declined event as payment_abandoned, the deepest ladder rung', () => {
    const state = journey({ emrEvents: [CheckoutEvent.CheckoutVisited, CheckoutEvent.OrderDeclined] });
    expect(classifier.classify(state)).toBe(AbandonmentState.Payment);
  });

  it('deepest evidence wins even when every shallower rung also holds', () => {
    const state = journey({
      cart: { lines: [{ slug: 'a', name: 'A', kind: 'otc', emr_product_id: null, parent_slug: null, quantity: 1, unit_price_cents: 100, variant_id: null }], territory: null },
      opportunityId: 'opp-1',
      formStatus: { 'teleform-1': 'in_progress' },
      emrEvents: [CheckoutEvent.CheckoutVisited, CheckoutEvent.OrderDeclined],
    });
    expect(classifier.classify(state)).toBe(AbandonmentState.Payment);
  });

  it('returns null once the journey is complete, regardless of other evidence', () => {
    const state = journey({ completedAt: '2026-01-01T00:00:00.000Z', emrEvents: [CheckoutEvent.OrderDeclined] });
    expect(classifier.classify(state)).toBeNull();
  });

  it('returns null once the journey is disqualified, regardless of other evidence', () => {
    const state = journey({ disqualifiedRule: 'rule-1', disqualifiedTeleform: 'teleform-1', emrEvents: [CheckoutEvent.OrderDeclined] });
    expect(classifier.classify(state)).toBeNull();
  });

  it('a placed order settles every rung below the upsell — no offer shown means null', () => {
    const state = journey({
      placedOrders: ['order-ref-1'],
      cart: { lines: [{ slug: 'a', name: 'A', kind: 'otc', emr_product_id: null, parent_slug: null, quantity: 1, unit_price_cents: 100, variant_id: null }], territory: null },
      emrEvents: [CheckoutEvent.CheckoutVisited],
    });
    expect(classifier.classify(state)).toBeNull();
  });

  it('a placed order with an unanswered upsell offer classifies as upsell_abandoned', () => {
    const state = journey({ placedOrders: ['order-ref-1'], upsellOutcomes: { 'upsell-1': JourneyState.UPSELL_OFFERED } });
    expect(classifier.classify(state)).toBe(AbandonmentState.Upsell);
  });

  it('a placed order with the upsell already answered is not abandoned', () => {
    const state = journey({ placedOrders: ['order-ref-1'], upsellOutcomes: { 'upsell-1': JourneyState.UPSELL_ACCEPTED } });
    expect(classifier.classify(state)).toBeNull();
  });
});

describe('AbandonmentState.depth', () => {
  it('orders the six states in funnel order', () => {
    expect(AbandonmentState.depth(AbandonmentState.Cart)).toBeLessThan(AbandonmentState.depth(AbandonmentState.Lead));
    expect(AbandonmentState.depth(AbandonmentState.Lead)).toBeLessThan(AbandonmentState.depth(AbandonmentState.Intake));
    expect(AbandonmentState.depth(AbandonmentState.Intake)).toBeLessThan(AbandonmentState.depth(AbandonmentState.Checkout));
    expect(AbandonmentState.depth(AbandonmentState.Checkout)).toBeLessThan(AbandonmentState.depth(AbandonmentState.Payment));
    expect(AbandonmentState.depth(AbandonmentState.Payment)).toBeLessThan(AbandonmentState.depth(AbandonmentState.Upsell));
  });
});
