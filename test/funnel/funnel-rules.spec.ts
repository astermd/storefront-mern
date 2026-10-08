import { Cart } from '../../src/domain/cart';
import { CartLine } from '../../src/domain/cart-line';
import { CatalogProduct } from '../../src/domain/product-catalog';
import { FunnelRules } from '../../src/funnel/funnel-rules';
import { FakeCatalog } from '../support/fake-catalog';

/**
 * `[8.0i]`: with two or more prescriptions in the cart every assessment is completed from the
 * patient portal after the order, so the storefront names no questionnaire at all — not the medical
 * intake, not the eligibility step, and not a form an OTC line beside them declares.
 */
describe('FunnelRules — collectsOnStorefront / assessmentAvailableFor / prescriptionStoppedBy', () => {
  function rules(products: CatalogProduct[]): FunnelRules {
    return new FunnelRules(new FakeCatalog(products));
  }

  function cartOf(kinds: Record<string, string>): Cart {
    const cart = new Cart();
    for (const [slug, kind] of Object.entries(kinds)) {
      cart.put(new CartLine(slug, slug, kind, null, null, 1, 1000, `${slug}-v1`));
    }
    return cart;
  }

  it('a cart with two prescriptions collects no questionnaire', () => {
    const funnel = rules([
      { slug: 'rx-a', name: 'Rx A', kind: 'rx', requires_prequalification: true, prequalification_teleform_id: 'tf-elig', teleform_id: 'tf-a' },
      { slug: 'rx-b', name: 'Rx B', kind: 'rx', teleform_id: 'tf-b' },
      { slug: 'otc-c', name: 'Otc C', kind: 'otc', teleform_id: 'tf-c' },
    ]);
    const cart = cartOf({ 'rx-a': 'rx', 'rx-b': 'rx', 'otc-c': 'otc' });

    expect(funnel.collectsOnStorefront(cart)).toBe(false);
    expect(funnel.prequalificationForms(cart)).toEqual([]);
    expect(funnel.intakeForms(cart)).toEqual([]);
    expect(funnel.outstandingPrequalificationForm(cart, null)).toBeNull();
    expect(funnel.outstandingIntakeForm(cart, null)).toBeNull();
    expect(funnel.intakeFormToCollect(cart, null)).toBeNull();
  });

  it('a cart with one prescription, and anything else beside it, is the funnel unchanged', () => {
    const funnel = rules([
      { slug: 'rx-a', name: 'Rx A', kind: 'rx', teleform_id: 'tf-a' },
      { slug: 'otc-c', name: 'Otc C', kind: 'otc', teleform_id: 'tf-c' },
    ]);
    const cart = cartOf({ 'rx-a': 'rx', 'otc-c': 'otc' });

    expect(funnel.collectsOnStorefront(cart)).toBe(true);
    expect(funnel.intakeForms(cart)).toEqual(['tf-a', 'tf-c']);
  });

  it('offers the assessment only while the cart would hold at most one prescription', () => {
    const funnel = rules([
      { slug: 'rx-a', name: 'Rx A', kind: 'rx', teleform_id: 'tf-a' },
      { slug: 'rx-b', name: 'Rx B', kind: 'rx', teleform_id: 'tf-b' },
      { slug: 'otc-c', name: 'Otc C', kind: 'otc' },
    ]);

    expect(funnel.assessmentAvailableFor(new Cart(), 'rx-a')).toBe(true);
    expect(funnel.assessmentAvailableFor(cartOf({ 'rx-a': 'rx' }), 'rx-a')).toBe(true);
    expect(funnel.assessmentAvailableFor(cartOf({ 'rx-a': 'rx' }), 'otc-c')).toBe(true);
    expect(funnel.assessmentAvailableFor(cartOf({ 'rx-a': 'rx' }), 'rx-b')).toBe(false);
    expect(funnel.assessmentAvailableFor(cartOf({ 'rx-a': 'rx', 'rx-b': 'rx' }), 'otc-c')).toBe(false);
  });

  describe('prescriptionStoppedBy', () => {
    it('returns the rx line whose teleform or prequalification form matches', () => {
      const funnel = rules([
        { slug: 'rx-a', name: 'Rx A', kind: 'rx', teleform_id: 'tf-a' },
        { slug: 'rx-b', name: 'Rx B', kind: 'rx', prequalification_teleform_id: 'tf-elig-b', teleform_id: 'tf-b' },
      ]);
      const cart = cartOf({ 'rx-a': 'rx', 'rx-b': 'rx' });

      expect(funnel.prescriptionStoppedBy(cart, 'tf-b')?.slug).toBe('rx-b');
      expect(funnel.prescriptionStoppedBy(cart, 'tf-elig-b')?.slug).toBe('rx-b');
    });

    it('falls back to the first prescription when nothing declares the form, or the form is null', () => {
      const funnel = rules([
        { slug: 'rx-a', name: 'Rx A', kind: 'rx', teleform_id: 'tf-a' },
        { slug: 'rx-b', name: 'Rx B', kind: 'rx', teleform_id: 'tf-b' },
      ]);
      const cart = cartOf({ 'rx-a': 'rx', 'rx-b': 'rx' });

      expect(funnel.prescriptionStoppedBy(cart, 'tf-unknown')?.slug).toBe('rx-a');
      expect(funnel.prescriptionStoppedBy(cart, null)?.slug).toBe('rx-a');
    });

    it('returns null for a cart with no prescription', () => {
      const funnel = rules([]);
      expect(funnel.prescriptionStoppedBy(new Cart(), 'tf-a')).toBeNull();
    });
  });
});
