import { Cart } from '../../src/domain/cart';
import { CartRules } from '../../src/domain/cart-rules';
import { FunnelRouter } from '../../src/domain/funnel-router';
import { JourneyState } from '../../src/journey/journey-state';
import { FakeCatalog } from '../support/fake-catalog';

const VERIFICATION_OFF = { enabled: false, placement: 'intake', blocking: false, checks: [] };

describe('FunnelRouter (Phase 4)', () => {
  it('routes an empty cart with no placed orders home', () => {
    const router = new FunnelRouter(new FakeCatalog(), VERIFICATION_OFF);
    expect(router.nextStep(new Cart(), null)).toBe('home');
  });

  it('routes an empty cart on a journey that already placed an order to the receipt', () => {
    const router = new FunnelRouter(new FakeCatalog(), VERIFICATION_OFF);
    const state = new JourneyState();
    state.recordPlacedOrder('order-1');

    expect(router.nextStep(new Cart(), state)).toBe('receipt');
  });

  it('routes a disqualified journey to not_eligible regardless of cart contents', () => {
    const catalog = new FakeCatalog([{ slug: 'vitamin-d', name: 'Vitamin D', kind: 'otc' }]);
    const router = new FunnelRouter(catalog, VERIFICATION_OFF);
    const cart = new Cart();
    new CartRules(catalog).add(cart, 'vitamin-d');
    const state = new JourneyState();
    state.recordDisqualification('teleform-1', 'rule-1');

    expect(router.nextStep(cart, state)).toBe('not_eligible');
  });

  it('routes a cart with an rx line missing a plan to home rather than checkout (`[12.7]`)', () => {
    const catalog = new FakeCatalog([{ slug: 'rx-a', name: 'Rx A', kind: 'rx' }]);
    const router = new FunnelRouter(catalog, VERIFICATION_OFF);
    const cart = new Cart();
    new CartRules(catalog).add(cart, 'rx-a');

    expect(router.nextStep(cart, null)).toBe('home');
  });

  it('routes a payable, non-disqualified cart with no outstanding forms straight to checkout', () => {
    const catalog = new FakeCatalog([{ slug: 'vitamin-d', name: 'Vitamin D', kind: 'otc' }]);
    const router = new FunnelRouter(catalog, VERIFICATION_OFF);
    const cart = new Cart();
    new CartRules(catalog).add(cart, 'vitamin-d');

    expect(router.nextStep(cart, null)).toBe('checkout');
  });

  it('routes to prequalification when the cart calls for one and it is outstanding', () => {
    const catalog = new FakeCatalog([
      {
        slug: 'weight-loss',
        name: 'Weight Loss',
        kind: 'otc',
        requires_prequalification: true,
        prequalification_teleform_id: 'prequal-1',
      },
    ]);
    const router = new FunnelRouter(catalog, VERIFICATION_OFF);
    const cart = new Cart();
    new CartRules(catalog).add(cart, 'weight-loss');

    expect(router.nextStep(cart, null)).toBe('prequalification');
  });

  it('routes to intake.medical when a completed prequalification leaves an outstanding intake form', () => {
    const catalog = new FakeCatalog([
      {
        slug: 'weight-loss',
        name: 'Weight Loss',
        kind: 'otc',
        requires_prequalification: true,
        prequalification_teleform_id: 'prequal-1',
        teleform_id: 'intake-1',
      },
    ]);
    const router = new FunnelRouter(catalog, VERIFICATION_OFF);
    const cart = new Cart();
    new CartRules(catalog).add(cart, 'weight-loss');
    const state = new JourneyState();
    state.markFormCompleted('prequal-1');

    expect(router.nextStep(cart, state)).toBe('intake.medical');
  });

  it('routes to verify when identity verification collects before payment and is outstanding', () => {
    const catalog = new FakeCatalog([{ slug: 'vitamin-d', name: 'Vitamin D', kind: 'otc' }]);
    const router = new FunnelRouter(catalog, { enabled: true, placement: 'intake', blocking: false, checks: [] });
    const cart = new Cart();
    new CartRules(catalog).add(cart, 'vitamin-d');

    expect(router.nextStep(cart, null)).toBe('verify');
  });
});
