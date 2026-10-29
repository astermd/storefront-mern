import { Cart } from '../../src/domain/cart';
import { CartRules } from '../../src/domain/cart-rules';
import { FakeCatalog } from '../support/fake-catalog';

describe('CartRules', () => {
  describe('add', () => {
    it('rejects a product the catalog does not know', () => {
      const rules = new CartRules(new FakeCatalog());
      const cart = new Cart();

      const outcome = rules.add(cart, 'unknown-slug');

      expect(outcome.accepted).toBe(false);
      expect(outcome.notice).toBe(CartRules.UNKNOWN_PRODUCT);
      expect(cart.isEmpty()).toBe(true);
    });

    it('adds an OTC product at its first variant price', () => {
      const catalog = new FakeCatalog([
        { slug: 'vitamin-d', name: 'Vitamin D', kind: 'otc', variants: [{ id: 'v1', name: 'Standard', price_cents: 1500 }] },
      ]);
      const rules = new CartRules(catalog);
      const cart = new Cart();

      const outcome = rules.add(cart, 'vitamin-d');

      expect(outcome.accepted).toBe(true);
      expect(cart.line('vitamin-d')?.unitPriceCents).toBe(1500);
      expect(cart.line('vitamin-d')?.quantity).toBe(1);
    });

    it('prices an rx line at zero until a variant is chosen (`[12.4]`)', () => {
      const catalog = new FakeCatalog([
        { slug: 'semaglutide', name: 'Semaglutide', kind: 'rx', variants: [{ id: 'plan-a', name: 'Plan A', price_cents: 5000 }] },
      ]);
      const rules = new CartRules(catalog);
      const cart = new Cart();

      rules.add(cart, 'semaglutide');

      expect(cart.line('semaglutide')?.unitPriceCents).toBe(0);
    });

    it('adding a second prescription keeps the first (`[8.0h]`)', () => {
      const catalog = new FakeCatalog([
        { slug: 'rx-a', name: 'Rx A', kind: 'rx', variants: [{ id: 'p', name: 'Plan', price_cents: 1000 }] },
        { slug: 'rx-b', name: 'Rx B', kind: 'rx', variants: [{ id: 'p', name: 'Plan', price_cents: 2000 }] },
      ]);
      const rules = new CartRules(catalog);
      const cart = new Cart();
      rules.add(cart, 'rx-a');

      const outcome = rules.add(cart, 'rx-b');

      expect(outcome.accepted).toBe(true);
      expect(outcome.notice).toBeNull();
      expect(cart.has('rx-a')).toBe(true);
      expect(cart.has('rx-b')).toBe(true);
      expect(cart.rxLines().map((line) => line.slug)).toEqual(['rx-a', 'rx-b']);
    });

    it('rejects a product blocked in the cart territory', () => {
      const catalog = new FakeCatalog([
        { slug: 'restricted', name: 'Restricted', kind: 'otc', geo_blocks: ['NY'] },
      ]);
      const rules = new CartRules(catalog);
      const cart = new Cart();
      cart.shippingTerritory = 'NY';

      const outcome = rules.add(cart, 'restricted');

      expect(outcome.accepted).toBe(false);
      expect(outcome.notice).toBe(CartRules.GEO_BLOCKED);
    });

    it('attaches a mandatory bundle child, priced at zero for a free-addon (`[7.14a]`)', () => {
      const catalog = new FakeCatalog([
        { slug: 'injectable', name: 'Injectable', kind: 'otc', bundles: ['syringe'] },
        { slug: 'syringe', name: 'Syringe', kind: 'free-addon', variants: [{ id: 'v', name: 'Standard', price_cents: 999 }] },
      ]);
      const rules = new CartRules(catalog);
      const cart = new Cart();

      rules.add(cart, 'injectable');

      const syringe = cart.line('syringe');
      expect(syringe?.isChild()).toBe(true);
      expect(syringe?.unitPriceCents).toBe(0);
    });

    it('brings a priced-addon along with its parent as its own line at its configured price', () => {
      const catalog = new FakeCatalog([
        { slug: 'organizer', name: 'Organizer', kind: 'otc', attachments: ['vitamin'], variants: [{ id: 'o-1', name: 'Standard', price_cents: 499 }] },
        { slug: 'vitamin', name: 'Multivitamin', kind: 'priced-addon', variants: [{ id: 'vit-1', name: 'Multivitamin', price_cents: 2500 }] },
      ]);
      const cart = new Cart();

      new CartRules(catalog).add(cart, 'organizer');

      const vitamin = cart.line('vitamin');
      expect(vitamin?.parentSlug).toBe('organizer');
      expect(vitamin?.unitPriceCents).toBe(2500);
      expect(cart.subtotalCents()).toBe(499 + 2500);
      expect(cart.itemCount()).toBe(1);
    });

    it('blocks the parent when a required child is unavailable in the territory (`[7.20]`)', () => {
      const catalog = new FakeCatalog([
        { slug: 'injectable', name: 'Injectable', kind: 'otc', bundles: ['syringe'] },
        { slug: 'syringe', name: 'Syringe', kind: 'free-addon', geo_blocks: ['NY'] },
      ]);
      const rules = new CartRules(catalog);
      const cart = new Cart();
      cart.shippingTerritory = 'NY';

      const outcome = rules.add(cart, 'injectable');

      expect(outcome.accepted).toBe(false);
      expect(outcome.notice).toContain('cannot be added right now');
      expect(cart.isEmpty()).toBe(true);
    });

    it('refuses to add a child line directly while its parent is present (`[7.8]`)', () => {
      const catalog = new FakeCatalog([
        { slug: 'injectable', name: 'Injectable', kind: 'otc', bundles: ['syringe'] },
        { slug: 'syringe', name: 'Syringe', kind: 'free-addon' },
      ]);
      const rules = new CartRules(catalog);
      const cart = new Cart();
      rules.add(cart, 'injectable');

      const outcome = rules.add(cart, 'syringe');

      expect(outcome.accepted).toBe(false);
      expect(outcome.notice).toContain('is included with');
    });
  });

  describe('remove', () => {
    it('removes a parent and its attached children together (`[7.9]`)', () => {
      const catalog = new FakeCatalog([
        { slug: 'injectable', name: 'Injectable', kind: 'otc', bundles: ['syringe'] },
        { slug: 'syringe', name: 'Syringe', kind: 'free-addon' },
      ]);
      const rules = new CartRules(catalog);
      const cart = new Cart();
      rules.add(cart, 'injectable');

      const outcome = rules.remove(cart, 'injectable');

      expect(outcome.accepted).toBe(true);
      expect(cart.isEmpty()).toBe(true);
    });

    it('refuses to remove a child directly (`[7.8]`)', () => {
      const catalog = new FakeCatalog([
        { slug: 'injectable', name: 'Injectable', kind: 'otc', bundles: ['syringe'] },
        { slug: 'syringe', name: 'Syringe', kind: 'free-addon' },
      ]);
      const rules = new CartRules(catalog);
      const cart = new Cart();
      rules.add(cart, 'injectable');

      const outcome = rules.remove(cart, 'syringe');

      expect(outcome.accepted).toBe(false);
      expect(cart.has('syringe')).toBe(true);
    });
  });

  describe('setQuantity', () => {
    it('caps quantity at the catalog max_buy_qty and reports the cap', () => {
      const catalog = new FakeCatalog([
        { slug: 'vitamin-d', name: 'Vitamin D', kind: 'otc', max_buy_qty: 3, variants: [{ id: 'v', name: 'Standard', price_cents: 100 }] },
      ]);
      const rules = new CartRules(catalog);
      const cart = new Cart();
      rules.add(cart, 'vitamin-d');

      const outcome = rules.setQuantity(cart, 'vitamin-d', 10);

      expect(outcome.accepted).toBe(true);
      expect(outcome.notice).toContain('up to 3');
      expect(cart.line('vitamin-d')?.quantity).toBe(3);
    });

    it('routes a zero-or-less quantity through remove()', () => {
      const catalog = new FakeCatalog([{ slug: 'vitamin-d', name: 'Vitamin D', kind: 'otc' }]);
      const rules = new CartRules(catalog);
      const cart = new Cart();
      rules.add(cart, 'vitamin-d');

      rules.setQuantity(cart, 'vitamin-d', 0);

      expect(cart.isEmpty()).toBe(true);
    });

    it('refuses to change an rx line quantity — fixed at one per order', () => {
      const catalog = new FakeCatalog([{ slug: 'rx-a', name: 'Rx A', kind: 'rx' }]);
      const rules = new CartRules(catalog);
      const cart = new Cart();
      rules.add(cart, 'rx-a');

      const outcome = rules.setQuantity(cart, 'rx-a', 2);

      expect(outcome.accepted).toBe(false);
      expect(outcome.notice).toBe(CartRules.RX_QTY_FIXED);
    });
  });

  describe('applyTerritory', () => {
    it('leaves the cart intact and names blocked products when the territory blocks a line (`[13.6]`)', () => {
      const catalog = new FakeCatalog([
        { slug: 'restricted', name: 'Restricted Product', kind: 'otc', geo_blocks: ['NY'] },
      ]);
      const rules = new CartRules(catalog);
      const cart = new Cart();
      rules.add(cart, 'restricted');

      const outcome = rules.applyTerritory(cart, 'NY');

      expect(outcome.accepted).toBe(false);
      expect(outcome.notice).toContain('Restricted Product');
      expect(cart.shippingTerritory).toBeNull();
      expect(cart.has('restricted')).toBe(true);
    });

    it('accepts and sets the territory when nothing is blocked', () => {
      const catalog = new FakeCatalog([{ slug: 'vitamin-d', name: 'Vitamin D', kind: 'otc' }]);
      const rules = new CartRules(catalog);
      const cart = new Cart();
      rules.add(cart, 'vitamin-d');

      const outcome = rules.applyTerritory(cart, 'CA');

      expect(outcome.accepted).toBe(true);
      expect(cart.shippingTerritory).toBe('CA');
    });
  });
});
