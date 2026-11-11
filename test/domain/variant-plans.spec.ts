import { Cart } from '../../src/domain/cart';
import { CartRules } from '../../src/domain/cart-rules';
import { CatalogProduct } from '../../src/domain/product-catalog';
import { VariantPlans } from '../../src/domain/variant-plans';
import { SettlementPolicy } from '../../src/checkout/settlement-policy';
import { capturedLog } from '../support/fake-emr-client';
import { FakeCatalog } from '../support/fake-catalog';

/** A variant sold on two plans (lamp's VariantPlans): the buyer chooses, and price, plan and settlement follow. */
const MONTHLY = { id: 'plan-a', name: 'Monthly', description: 'Billed monthly', first_payment_cents: 2000, settlement: 'capture' };
const QUARTERLY = { id: 'plan-b', name: 'Quarterly', description: 'Billed every 3 months', first_payment_cents: 3000, settlement: 'authorize' };

function nad(): CatalogProduct {
  return {
    slug: 'nad',
    name: 'NAD+',
    kind: 'otc',
    variants: [
      { id: 'v1', name: 'NAD+', price_cents: 2000, list_price_cents: 1000, plan: MONTHLY, plans: [MONTHLY, QUARTERLY] },
      { id: 'v2', name: 'One-off', price_cents: 1500 },
    ],
  };
}

describe('VariantPlans', () => {
  const variant = nad().variants![0];

  it('lists the default first, then the others, and nothing for a one-off variant', () => {
    expect(VariantPlans.of(variant).map((plan) => plan.id)).toEqual(['plan-a', 'plan-b']);
    expect(VariantPlans.of(nad().variants![1])).toEqual([]);
    // `plans` is never read without `plan`: an override that sells it one-off clears `plan` alone.
    expect(VariantPlans.of({ ...variant, plan: null })).toEqual([]);
  });

  it('resolves the chosen plan, falling back to the default for an id it no longer offers', () => {
    expect(VariantPlans.chosen(variant, 'plan-b')?.id).toBe('plan-b');
    expect(VariantPlans.chosen(variant, 'gone')?.id).toBe('plan-a');
    expect(VariantPlans.chosen(variant, null)?.id).toBe('plan-a');
    expect(VariantPlans.offers(variant, 'gone')).toBe(false);
  });
});

describe('CartRules.chooseSubscription', () => {
  it("puts a new line on the default plan and re-prices it at the chosen plan's first payment", () => {
    const rules = new CartRules(new FakeCatalog([nad()]));
    const cart = new Cart();

    rules.add(cart, 'nad');
    expect(cart.line('nad')).toMatchObject({ planId: 'plan-a', unitPriceCents: 2000 });

    expect(rules.chooseSubscription(cart, 'nad', 'plan-b').accepted).toBe(true);
    expect(cart.line('nad')).toMatchObject({ planId: 'plan-b', unitPriceCents: 3000 });

    // Back to the default: the variant's own (synced or overridden) price stands.
    rules.chooseSubscription(cart, 'nad', 'plan-a');
    expect(cart.line('nad')?.unitPriceCents).toBe(2000);
  });

  it('refuses a plan the variant is not sold on', () => {
    const rules = new CartRules(new FakeCatalog([nad()]));
    const cart = new Cart();
    rules.add(cart, 'nad');

    const outcome = rules.chooseSubscription(cart, 'nad', 'plan-z');
    expect(outcome.accepted).toBe(false);
    expect(outcome.notice).toBe(CartRules.UNKNOWN_SUBSCRIPTION);
    expect(cart.line('nad')?.planId).toBe('plan-a');
  });

  it('drops the plan when the buyer switches to a one-off variant', () => {
    const rules = new CartRules(new FakeCatalog([nad()]));
    const cart = new Cart();
    rules.add(cart, 'nad');
    rules.chooseSubscription(cart, 'nad', 'plan-b');

    rules.chooseVariant(cart, 'nad', 'v2');
    expect(cart.line('nad')).toMatchObject({ planId: null, unitPriceCents: 1500 });
  });

  it('keeps the chosen plan through the stored cart', () => {
    const rules = new CartRules(new FakeCatalog([nad()]));
    const cart = new Cart();
    rules.add(cart, 'nad');
    rules.chooseSubscription(cart, 'nad', 'plan-b');

    expect(Cart.fromArray(cart.toArray()).line('nad')?.planId).toBe('plan-b');
  });
});

describe('SettlementPolicy.forLines', () => {
  function policy(defaultMode: string): { policy: SettlementPolicy; cart: Cart; rules: CartRules } {
    const catalog = new FakeCatalog([nad()]);
    return {
      policy: new SettlementPolicy(catalog, { payment: { settlement: defaultMode } } as never, capturedLog().log),
      cart: new Cart(),
      rules: new CartRules(catalog),
    };
  }

  it("settles a plan line as its plan's first charge says, not the deployment default", () => {
    const { policy: p, cart, rules } = policy('authorize');
    rules.add(cart, 'nad');
    expect(p.forLines(...cart.lines())).toBe('capture');

    rules.chooseSubscription(cart, 'nad', 'plan-b');
    expect(p.forLines(...cart.lines())).toBe('authorize');
  });

  it('settles a one-off line by the default, as before', () => {
    const { policy: p, cart, rules } = policy('authorize');
    rules.add(cart, 'nad');
    rules.chooseVariant(cart, 'nad', 'v2');
    expect(p.forLines(...cart.lines())).toBe('authorize');
  });
});
