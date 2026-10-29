import { CatalogValidator } from '../../src/catalog/catalog-validator';
import { CatalogProduct } from '../../src/domain/product-catalog';

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    slug: 'p1',
    name: 'Widget',
    kind: 'otc',
    variants: [{ id: 'v1', name: 'Standard', price_cents: 1000, provider: { offer_id: 'o', product_id: 'p' } }],
    bundles: [],
    attachments: [],
    ...overrides,
  };
}

describe('CatalogValidator', () => {
  const validator = new CatalogValidator();

  it('warns when the channel key is absent, but does not error', () => {
    const result = validator.validate({ products: { p1: product() } });
    expect(result.warnings).toContain('channel key absent');
    expect(result.errors).toHaveLength(0);
  });

  it('errors on a channel currency that is not a 3-letter uppercase code', () => {
    const result = validator.validate({ channel: { currency: 'usd' }, products: {} });
    expect(result.errors).toContainEqual(expect.stringContaining('not a 3-letter uppercase ISO code'));
  });

  it('errors when a required field is missing or blank', () => {
    const result = validator.validate({ channel: {}, products: { p1: product({ name: '' }) } });
    expect(result.errors).toContainEqual(expect.stringContaining('missing/blank or invalid required field "name"'));
  });

  it('errors when kind is not one of the allowed values', () => {
    const result = validator.validate({ channel: {}, products: { p1: product({ kind: 'subscription' }) } });
    expect(result.errors).toContainEqual(expect.stringContaining('is not one of rx, otc, lab, free-addon, priced-addon'));
  });

  it('errors when a bundle/attachment slug resolves to no product', () => {
    const result = validator.validate({ channel: {}, products: { p1: product({ bundles: ['no-such-slug'] }) } });
    expect(result.errors).toContainEqual(expect.stringContaining('bundles slug "no-such-slug" resolves to no product'));
  });

  it('accepts a bundle slug that does resolve to a real product', () => {
    const result = validator.validate({
      channel: {},
      products: { p1: product({ bundles: ['p2'] }), p2: product({ slug: 'p2' }) },
    });
    expect(result.errors).toHaveLength(0);
  });

  it('treats a missing variants key as a legacy-seed warning, not an error', () => {
    const legacy = product();
    delete (legacy as Partial<CatalogProduct>).variants;
    const result = validator.validate({ channel: {}, products: { p1: legacy } });
    expect(result.warnings).toContainEqual(expect.stringContaining('legacy-seed product lacks variants'));
    expect(result.errors).toHaveLength(0);
  });

  it('errors when variants is explicitly an empty list', () => {
    const result = validator.validate({ channel: {}, products: { p1: product({ variants: [] }) } });
    expect(result.errors).toContainEqual(expect.stringContaining('variants list is empty'));
  });

  it('errors on a negative or non-integer price_cents', () => {
    const result = validator.validate({
      channel: {},
      products: { p1: product({ variants: [{ id: 'v1', name: 'Standard', price_cents: -5, provider: null }] }) },
    });
    expect(result.errors).toContainEqual(expect.stringContaining('price_cents is not a non-negative int'));
  });

  it('warns (not errors) when a variant has no provider mapping', () => {
    const result = validator.validate({
      channel: {},
      products: { p1: product({ variants: [{ id: 'v1', name: 'Standard', price_cents: 1000, provider: null }] }) },
    });
    expect(result.warnings).toContainEqual(expect.stringContaining('need provider identifiers in the override layer'));
    expect(result.errors).toHaveLength(0);
  });

  it('warns when variants differ in price (spec 29.3)', () => {
    const result = validator.validate({
      channel: {},
      products: {
        p1: product({
          variants: [
            { id: 'v1', name: 'A', price_cents: 1000, provider: null },
            { id: 'v2', name: 'B', price_cents: 2000, provider: null },
          ],
        }),
      },
    });
    expect(result.warnings).toContainEqual(expect.stringContaining('variants differ in price'));
  });
});
