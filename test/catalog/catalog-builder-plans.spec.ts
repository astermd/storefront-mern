import { CatalogBuilder } from '../../src/catalog/catalog-builder';
import { PlanRow, SubscriptionPlans } from '../../src/catalog/subscription-plans';
import { ThemeSyncCommand } from '../../src/console/theme-sync.command';

const PRODUCT_ID = '6a1c28245f315cee0e41c346';
const VARIANT_ID = '6a1c28245f315cee0e41c344';
const PLAN_ID = '6adf4668a103373c607b85a1';

function channel(provider: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: 'chan1',
    name: 'Channel',
    payment_processor: { provider_category: provider },
    products: [
      {
        product: { status: 1, visibility: 'Public', _id: PRODUCT_ID, name: 'Tadalafil', type: 'prescription', variants: [{ _id: VARIANT_ID, name: '20mg', default_price: 49 }, { _id: 'v2', name: '10mg', default_price: 30 }] },
        product_mappings: [],
        add_ons: [],
      },
    ],
    subscriptions: [
      {
        plan_id: PLAN_ID,
        plan: {
          _id: PLAN_ID,
          name: 'tadalafil-monthly',
          display_name: 'Tadalafil — monthly',
          product_id: PRODUCT_ID,
          steps: [
            {
              step_id: 's1',
              type: 'shipment',
              schedule: { start_day: 0, recurrence: 'ongoing', interval_days: 30, occurrence_count: 1 },
              items_by_cycle: [{ items: [{ product_id: PRODUCT_ID, variant_id: VARIANT_ID, price_cents: 9900, quantity: 1 }] }],
            },
            {
              step_id: 'c1',
              type: 'charge',
              schedule: { start_day: 0, recurrence: 'ongoing', interval_days: 30, occurrence_count: 1 },
              amount_source: 'from_products',
              pays_for_step_ids: ['s1'],
            },
          ],
        },
      },
    ],
    ...extra,
  };
}

function row(overrides: Partial<PlanRow> = {}): PlanRow {
  return { plan_id: PLAN_ID, name: 'n', display_name: 'Display', product_id: PRODUCT_ID, variant_id: VARIANT_ID, first_payment_cents: 9900, allow_coupons: true, ...overrides };
}

function variants(data: Record<string, unknown>, plans: PlanRow[]) {
  return Object.values(CatalogBuilder.build(data, 'USD', plans).products)[0].variants!;
}

describe('CatalogBuilder plans', () => {
  it('sells a variant on its plan at the plan\'s first payment, keeping its own price as list price', () => {
    const [onPlan, oneOff] = variants(channel('stripe'), [row()]);
    expect(onPlan.plan).toEqual({ id: PLAN_ID, name: 'Display', first_payment_cents: 9900, allow_coupons: true });
    expect(onPlan.price_cents).toBe(9900);
    expect(onPlan.list_price_cents).toBe(4900);
    expect(oneOff.plan).toBeUndefined();
    expect(oneOff.price_cents).toBe(3000);
  });

  it('mirrors the first variant\'s plan price onto the product', () => {
    const product = Object.values(CatalogBuilder.build(channel('stripe'), 'USD', [row()]).products)[0];
    expect(product.price_cents).toBe(9900);
  });

  it('lets the lower plan id win when two plans sell the same variant', () => {
    const [v] = variants(channel('stripe'), [row({ plan_id: 'b'.repeat(24), first_payment_cents: 1 }), row({ plan_id: 'a'.repeat(24), first_payment_cents: 2 })]);
    expect(v.plan?.id).toBe('a'.repeat(24));
    expect(v.price_cents).toBe(2);
  });

  it('skips a plan it cannot price', () => {
    const [v] = variants(channel('stripe'), [row({ first_payment_cents: -1 }), row({ first_payment_cents: 9.5 })]);
    expect(v.plan).toBeUndefined();
    expect(v.price_cents).toBe(4900);
  });

  it('is unchanged with no plans', () => {
    const [v] = variants(channel('stripe'), []);
    expect(v.plan).toBeUndefined();
    expect(v.price_cents).toBe(4900);
  });
});

describe('ThemeSyncCommand.sellablePlans', () => {
  it('sells plans on a Stripe channel', () => {
    expect(ThemeSyncCommand.PLAN_PROVIDERS).toEqual(['stripe']);
    const plans = ThemeSyncCommand.sellablePlans(channel('stripe'));
    expect(plans).toEqual(SubscriptionPlans.fromChannelDetails(channel('stripe')));
    const [v] = variants(channel('stripe'), plans);
    expect([v.plan?.id, v.price_cents, v.list_price_cents]).toEqual([PLAN_ID, 9900, 4900]);
  });

  it('sells everything one-off on a CRM channel, with the same data', () => {
    expect(ThemeSyncCommand.sellablePlans(channel('vrio'))).toEqual([]);
    expect(ThemeSyncCommand.sellablePlans(channel('checkout_champ'))).toEqual([]);
    expect(ThemeSyncCommand.sellablePlans({ subscriptions: channel('stripe').subscriptions })).toEqual([]);
    expect(variants(channel('vrio'), ThemeSyncCommand.sellablePlans(channel('vrio')))[0].plan).toBeUndefined();
  });
});
