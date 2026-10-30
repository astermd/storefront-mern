import { SubscriptionPlans } from '../../src/catalog/subscription-plans';

const PLAN_ID = '6adf4668a103373c607b85a1';
const PRODUCT_ID = '6a1c28245f315cee0e41c346';
const VARIANT_ID = '6a1c28245f315cee0e41c344';

type Rec = Record<string, unknown>;

function plan(steps: Rec[], overrides: Rec = {}): Rec {
  return { _id: PLAN_ID, name: 'tadalafil-monthly', display_name: 'Tadalafil — monthly', product_id: PRODUCT_ID, steps, ...overrides };
}

function monthly(startDay = 0, recurrence = 'ongoing', count = 1): Rec {
  return { start_day: startDay, recurrence, interval_days: 30, occurrence_count: count };
}

function shipment(id: string, cycles: Rec[][], schedule: Rec): Rec {
  return { step_id: id, type: 'shipment', schedule, items_by_cycle: cycles.map((items) => ({ items })) };
}

function item(priceCents: unknown, quantity = 1, variantId: string | null = VARIANT_ID): Rec {
  return { product_id: PRODUCT_ID, variant_id: variantId, price_cents: priceCents, quantity };
}

describe('SubscriptionPlans', () => {
  it('prices a fixed first charge as its own amount', () => {
    const p = plan([{ step_id: 'c1', type: 'charge', schedule: monthly(), amount_source: 'fixed', amount_cents: 9900 }]);
    expect(SubscriptionPlans.firstPayment(p)).toEqual({ amount_cents: 9900, allow_coupons: true });
  });

  it('pays each shipment cycle due before the charge\'s next occurrence', () => {
    // Charged every 60 days for a shipment every 30: the first charge pays cycles 0 and 1.
    const p = plan([
      shipment('s1', [[item(2500, 2)], [item(3000)]], monthly()),
      {
        step_id: 'c1',
        type: 'charge',
        schedule: { start_day: 0, recurrence: 'ongoing', interval_days: 60, occurrence_count: 1 },
        amount_source: 'from_products',
        pays_for_step_ids: ['s1'],
      },
    ]);
    expect(SubscriptionPlans.firstPayment(p)).toEqual({ amount_cents: 8000, allow_coupons: true });
  });

  it('adds the price of a lab test paid for', () => {
    const p = plan([
      { step_id: 'l1', type: 'lab_test', schedule: monthly(0, 'once'), price_cents: 4500 },
      { step_id: 'c1', type: 'charge', schedule: monthly(0, 'once'), amount_source: 'from_lab_tests', pays_for_step_ids: ['l1'] },
    ]);
    expect(SubscriptionPlans.firstPayment(p)).toEqual({ amount_cents: 4500, allow_coupons: true });
  });

  it('takes a pre-auth\'s coupon rule from the step that captures it', () => {
    const p = plan([
      { step_id: 'hold', type: 'charge', schedule: monthly(0, 'once'), payment_mode: 'pre_auth', amount_source: 'fixed', amount_cents: 12000, allow_coupons: true },
      { step_id: 'take', type: 'charge', schedule: monthly(0, 'once'), captures_step_id: 'hold', allow_coupons: false },
    ]);
    expect(SubscriptionPlans.firstPayment(p)).toEqual({ amount_cents: 12000, allow_coupons: false });
  });

  it('charges nothing at checkout when no charge is due on day zero', () => {
    const p = plan([{ step_id: 'c1', type: 'charge', schedule: monthly(14), amount_source: 'fixed', amount_cents: 9900 }]);
    expect(SubscriptionPlans.firstPayment(p)).toEqual({ amount_cents: 0, allow_coupons: true });
  });

  it('cannot price an unreadable price', () => {
    const p = plan([
      shipment('s1', [[item('free')]], monthly()),
      { step_id: 'c1', type: 'charge', schedule: monthly(), amount_source: 'from_products', pays_for_step_ids: ['s1'] },
    ]);
    expect(SubscriptionPlans.firstPayment(p)).toBeNull();
  });

  it('names the variant the first shipment cycle ships, else the product itself', () => {
    expect(SubscriptionPlans.productRef(plan([shipment('s1', [[item(2500)]], monthly())]))).toEqual({ product_id: PRODUCT_ID, variant_id: VARIANT_ID });
    expect(SubscriptionPlans.productRef(plan([]))).toEqual({ product_id: PRODUCT_ID, variant_id: PRODUCT_ID });
    expect(SubscriptionPlans.productRef(plan([], { product_id: null }))).toBeNull();
  });

  it('turns the channel\'s subscriptions into the rows the catalog sells on', () => {
    const priced = plan([
      shipment('s1', [[item(2500)]], monthly()),
      { step_id: 'c1', type: 'charge', schedule: monthly(), amount_source: 'fixed', amount_cents: 9900, allow_coupons: false },
    ]);
    const noProduct = plan([], { _id: '6adf4668a103373c607b85a2', product_id: null });
    const unpriceable = plan([{ step_id: 'c1', type: 'charge', schedule: monthly(), amount_source: 'fixed', amount_cents: -1 }], { _id: '6adf4668a103373c607b85a3' });

    const rows = SubscriptionPlans.fromChannelDetails({
      subscriptions: [
        { plan_id: PLAN_ID, plan: priced },
        { plan_id: '6adf4668a103373c607b85a2', plan: noProduct },
        { plan_id: '6adf4668a103373c607b85a3', plan: unpriceable },
        { plan_id: '6adf4668a103373c607b85a4', plan: null },
      ],
    });

    expect(rows).toEqual([
      {
        plan_id: PLAN_ID,
        name: 'tadalafil-monthly',
        display_name: 'Tadalafil — monthly',
        product_id: PRODUCT_ID,
        variant_id: VARIANT_ID,
        first_payment_cents: 9900,
        allow_coupons: false,
      },
    ]);
  });

  it('sells no plans for a channel without subscriptions', () => {
    expect(SubscriptionPlans.fromChannelDetails({})).toEqual([]);
  });
});
