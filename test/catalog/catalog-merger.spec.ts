import { CatalogMerger } from '../../src/catalog/catalog-merger';
import { GeneratedCatalog } from '../../config/products.generated';
import { ProductsOverrides } from '../../config/products.overrides';

function catalog(products: GeneratedCatalog['products']): GeneratedCatalog {
  return { channel: { id: 'c', name: 'Channel', currency: 'USD' }, products };
}

describe('CatalogMerger', () => {
  it('replaces override fields wholesale, matched by emr_product_id (never slug)', () => {
    const merger = new CatalogMerger();
    const generated = catalog({
      'vitamin-d': {
        slug: 'vitamin-d',
        name: 'Vitamin D',
        kind: 'otc',
        emr_product_id: 'emr-1',
        variants: [{ id: 'v1', name: 'Standard', price_cents: 1500 }],
      },
    });
    const overrides: ProductsOverrides = { products: { 'emr-1': { geo_blocks: ['NY'] } } };

    const merged = merger.merge(generated, overrides);

    expect(merged.products['vitamin-d'].geo_blocks).toEqual(['NY']);
    expect(merged.products['vitamin-d'].name).toBe('Vitamin D');
  });

  it('merges variant overrides per-field, leaving unmentioned variants untouched', () => {
    const merger = new CatalogMerger();
    const generated = catalog({
      rx: {
        slug: 'rx',
        name: 'Rx',
        kind: 'rx',
        emr_product_id: 'emr-2',
        variants: [
          { id: 'v1', name: 'Monthly', price_cents: 1000 },
          { id: 'v2', name: 'Quarterly', price_cents: 2500 },
        ],
      },
    });
    const overrides: ProductsOverrides = {
      products: { 'emr-2': { variants: { v1: { price_cents: 1200 } } } },
    };

    const merged = merger.merge(generated, overrides);
    const variants = merged.products.rx.variants!;

    expect(variants.find((v) => v.id === 'v1')?.price_cents).toBe(1200);
    expect(variants.find((v) => v.id === 'v2')?.price_cents).toBe(2500);
  });

  it('re-keys the product map when an override sets a new slug', () => {
    const merger = new CatalogMerger();
    const generated = catalog({
      old: { slug: 'old', name: 'Old', kind: 'otc', emr_product_id: 'emr-3' },
    });
    const overrides: ProductsOverrides = { products: { 'emr-3': { slug: 'new' } } };

    const merged = merger.merge(generated, overrides);

    expect(merged.products['old']).toBeUndefined();
    expect(merged.products['new']?.slug).toBe('new');
  });

  it('adds a full net-new product definition for an unmatched override id', () => {
    const merger = new CatalogMerger();
    const generated = catalog({});
    const overrides: ProductsOverrides = {
      products: {
        'emr-lab-1': {
          slug: 'metabolic-panel',
          name: 'Comprehensive Metabolic Panel',
          kind: 'lab',
          variants: [{ id: 'v1', name: 'Standard', price_cents: 5000 }],
        },
      },
    };

    const merged = merger.merge(generated, overrides);

    expect(merged.products['metabolic-panel']?.name).toBe('Comprehensive Metabolic Panel');
    expect(merger.lastIgnoredOverrideIds()).toEqual([]);
  });

  it('ignores (and records) an override id matching nothing that is not a full product definition', () => {
    const merger = new CatalogMerger();
    const generated = catalog({});
    const overrides: ProductsOverrides = { products: { 'emr-ghost': { geo_blocks: ['NY'] } } };

    const merged = merger.merge(generated, overrides);

    expect(Object.keys(merged.products)).toHaveLength(0);
    expect(merger.lastIgnoredOverrideIds()).toEqual(['emr-ghost']);
  });

  it('records an unmatched variant override id as "<productId>:<variantId>"', () => {
    const merger = new CatalogMerger();
    const generated = catalog({
      rx: {
        slug: 'rx',
        name: 'Rx',
        kind: 'rx',
        emr_product_id: 'emr-4',
        variants: [{ id: 'v1', name: 'Monthly', price_cents: 1000 }],
      },
    });
    const overrides: ProductsOverrides = {
      products: { 'emr-4': { variants: { 'no-such-variant': { price_cents: 1 } } } },
    };

    merger.merge(generated, overrides);

    expect(merger.lastIgnoredOverrideIds()).toEqual(['emr-4:no-such-variant']);
  });

  it('throws on a duplicate slug among generated products', () => {
    const merger = new CatalogMerger();
    const generated: GeneratedCatalog = {
      channel: { id: 'c', name: 'Channel', currency: 'USD' },
      products: {
        a: { slug: 'dup', name: 'A', kind: 'otc', emr_product_id: 'emr-a' },
        b: { slug: 'dup', name: 'B', kind: 'otc', emr_product_id: 'emr-b' },
      },
    };

    expect(() => merger.merge(generated, { products: {} })).toThrow(/Duplicate product slug/);
  });
});
