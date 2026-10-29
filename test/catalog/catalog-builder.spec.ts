import { CatalogBuilder } from '../../src/catalog/catalog-builder';

function entry(overrides: Record<string, unknown> = {}, product: Record<string, unknown> = {}) {
  return {
    product: { status: 1, visibility: 'Public', _id: 'prod001', name: 'Widget', type: 'standard', ...product },
    product_mappings: [],
    add_ons: [],
    ...overrides,
  };
}

describe('CatalogBuilder', () => {
  it('skips a product that is not active and public', () => {
    const inactive = CatalogBuilder.build({ products: [entry({}, { status: 0 })] });
    expect(Object.keys(inactive.products)).toHaveLength(0);

    const notPublic = CatalogBuilder.build({ products: [entry({}, { visibility: 'Private' })] });
    expect(Object.keys(notPublic.products)).toHaveLength(0);
  });

  it('maps EMR type "prescription" to rx and everything else to otc', () => {
    const rx = CatalogBuilder.build({ products: [entry({}, { type: 'prescription' })] });
    const otc = CatalogBuilder.build({ products: [entry({}, { type: 'standard' })] });
    const otcDefault = CatalogBuilder.build({ products: [entry({}, { type: undefined })] });

    expect(Object.values(rx.products)[0].kind).toBe('rx');
    expect(Object.values(otc.products)[0].kind).toBe('otc');
    expect(Object.values(otcDefault.products)[0].kind).toBe('otc');
  });

  it('builds the slug from the first 6 chars of the id plus a slugified name', () => {
    const catalog = CatalogBuilder.build({ products: [entry({}, { _id: 'abcdef1234', name: 'My Cool Widget!!' })] });
    expect(Object.keys(catalog.products)).toEqual(['abcdef-my-cool-widget']);
  });

  it('synthesizes a single variant from the product itself when variants is empty, matching its id to product_mappings', () => {
    const catalog = CatalogBuilder.build({
      products: [
        entry(
          { product_mappings: [{ variant_id: 'prod001', mapping: { offer_id: 'off-1', product_id: 'p-1' } }] },
          { _id: 'prod001', single: [{ default_price: 25.5 }] },
        ),
      ],
    });

    const product = Object.values(catalog.products)[0];
    expect(product.variants).toHaveLength(1);
    expect(product.variants?.[0].id).toBe('prod001');
    expect(product.variants?.[0].price_cents).toBe(2550);
    expect(product.variants?.[0].provider).toEqual({ offer_id: 'off-1', product_id: 'p-1' });
    expect(product.price_cents).toBe(2550);
  });

  it('resolves real variants from default_price in dollars to price_cents, first matching mapping wins', () => {
    const catalog = CatalogBuilder.build({
      products: [
        entry(
          {
            product_mappings: [
              { variant_id: 'v1', mapping: { offer_id: 'vrio-offer', product_id: 'vrio-product' } },
              { variant_id: 'v1', mapping: { offer_id: 'cc-offer', product_id: 'cc-product' } },
            ],
          },
          { variants: [{ _id: 'v1', name: 'Monthly', default_price: 49.99 }] },
        ),
      ],
    });

    const variant = Object.values(catalog.products)[0].variants?.[0];
    expect(variant?.price_cents).toBe(4999);
    expect(variant?.provider).toEqual({ offer_id: 'vrio-offer', product_id: 'vrio-product' });
  });

  it('prefers the mapping whose type matches the channel\'s active payment processor over array order', () => {
    // Confirmed live against the real AsterMD channel: Rameltion's variant carries both a `vrio`
    // and a `checkout_champ` mapping, `vrio` sitting first in array order, while the channel's own
    // `payment_processor.provider_category` is `checkout_champ` -- taking "first" regardless of
    // type sent CheckoutChamp a Vrio-side offer id it had never heard of, and its real API refused
    // the charge outright ("Must provide campaignId"), not because of anything wrong with the card.
    const catalog = CatalogBuilder.build({
      payment_processor: { provider_category: 'checkout_champ' },
      products: [
        entry(
          {
            product_mappings: [
              { variant_id: 'v1', type: 'vrio', mapping: { offer_id: 'vrio-offer', product_id: 'vrio-product' } },
              { variant_id: 'v1', type: 'checkout_champ', mapping: { offer_id: 'cc-offer', product_id: 'cc-product' } },
            ],
          },
          { variants: [{ _id: 'v1', name: 'Monthly', default_price: 49.99 }] },
        ),
      ],
    });

    const variant = Object.values(catalog.products)[0].variants?.[0];
    expect(variant?.provider).toEqual({ offer_id: 'cc-offer', product_id: 'cc-product' });
  });

  it('falls back to the first matching mapping when none carries the active processor\'s type', () => {
    const catalog = CatalogBuilder.build({
      payment_processor: { provider_category: 'checkout_champ' },
      products: [
        entry(
          {
            product_mappings: [
              { variant_id: 'v1', type: 'vrio', mapping: { offer_id: 'vrio-offer', product_id: 'vrio-product' } },
            ],
          },
          { variants: [{ _id: 'v1', name: 'Monthly', default_price: 49.99 }] },
        ),
      ],
    });

    const variant = Object.values(catalog.products)[0].variants?.[0];
    expect(variant?.provider).toEqual({ offer_id: 'vrio-offer', product_id: 'vrio-product' });
  });

  it('reports no provider mapping as null, not a missing/undefined field', () => {
    const catalog = CatalogBuilder.build({ products: [entry({}, { variants: [{ _id: 'v1', name: 'Monthly', default_price: 10 }] })] });
    expect(Object.values(catalog.products)[0].variants?.[0].provider).toBeNull();
  });

  it('builds a standalone lab product from labtest[] and records it in the parent bundles', () => {
    const catalog = CatalogBuilder.build({
      products: [entry({}, { labtest: [{ _id: 'lab001', name: 'Blood Panel', variants: [] }] })],
    });

    const parent = Object.values(catalog.products).find((p) => p.kind !== 'lab');
    const lab = Object.values(catalog.products).find((p) => p.kind === 'lab');

    expect(lab).toBeDefined();
    expect(lab?.bundles).toEqual([]);
    expect(parent?.bundles).toEqual([lab?.slug]);
  });

  it('builds a standalone free-addon product from the wrapper entry add_ons[], not from inside product', () => {
    const catalog = CatalogBuilder.build({
      products: [entry({ add_ons: [{ _id: 'addon001', name: 'Syringe Kit', variants: [] }] })],
    });

    const addon = Object.values(catalog.products).find((p) => p.kind === 'free-addon');
    expect(addon).toBeDefined();
    expect(addon?.attachments).toEqual([]);
  });

  it('dedupes the same nested labtest id referenced by two different parents into one product', () => {
    const sharedLab = { _id: 'lab001', name: 'Shared Panel', variants: [] };
    const catalog = CatalogBuilder.build({
      products: [
        entry({}, { _id: 'parent1', name: 'Parent One', labtest: [sharedLab] }),
        entry({}, { _id: 'parent2', name: 'Parent Two', labtest: [sharedLab] }),
      ],
    });

    const labs = Object.values(catalog.products).filter((p) => p.kind === 'lab');
    expect(labs).toHaveLength(1);
  });

  it('throws on a genuine slug collision between two different top-level products', () => {
    expect(() =>
      CatalogBuilder.build({
        products: [entry({}, { _id: 'same01', name: 'Widget' }), entry({}, { _id: 'same01', name: 'Widget' })],
      }),
    ).toThrow(/slug collision/);
  });

  it('never assigns a provider mapping to a nested lab/add-on product, even with a matching mapping present', () => {
    const catalog = CatalogBuilder.build({
      products: [
        entry(
          { product_mappings: [{ variant_id: 'lab001', mapping: { offer_id: 'x', product_id: 'y' } }] },
          { labtest: [{ _id: 'lab001', name: 'Panel', variants: [] }] },
        ),
      ],
    });

    const lab = Object.values(catalog.products).find((p) => p.kind === 'lab');
    expect(lab?.variants?.[0].provider).toBeNull();
  });

  it('resolves an add-on provider from its own product_mappings, leaving the parent on its own', () => {
    const mapping = (variantId: string, offer: string, product: string) => ({ variant_id: variantId, mapping: { offer_id: offer, product_id: product } });
    const catalog = CatalogBuilder.build({
      products: [
        entry(
          { product_mappings: [mapping('parent01', '338', '9001')], add_ons: [{ _id: 'addon001', name: 'Mapped Addon', single: [{ default_price: 5 }], variants: [], product_mappings: [mapping('addon001', '340', '2846')] }] },
          { _id: 'parent01', name: 'Parent Product' },
        ),
      ],
    });

    const addon = Object.values(catalog.products).find((p) => p.slug.endsWith('mapped-addon'));
    const parent = Object.values(catalog.products).find((p) => p.slug.endsWith('parent-product'));
    expect(addon?.variants?.[0].provider).toEqual({ offer_id: '340', product_id: '2846' });
    expect(parent?.variants?.[0].provider).toEqual({ offer_id: '338', product_id: '9001' });
  });

  it('never lets an add-on inherit its parent\'s mappings, even one keyed by the add-on\'s own id', () => {
    const catalog = CatalogBuilder.build({
      products: [
        entry(
          { product_mappings: [{ variant_id: 'addon001', mapping: { offer_id: '338', product_id: '9001' } }], add_ons: [{ _id: 'addon001', name: 'Unmapped Addon', single: [{ default_price: 5 }], variants: [] }] },
        ),
      ],
    });

    const addon = Object.values(catalog.products).find((p) => p.slug.endsWith('unmapped-addon'));
    expect(addon?.variants?.[0].provider).toBeNull();
  });

  it('keeps an add-on with no price a free-addon', () => {
    const catalog = CatalogBuilder.build({ products: [entry({ add_ons: [{ _id: 'addon001', name: 'Free Addon', variants: [] }] })] });

    expect(Object.values(catalog.products).find((p) => p.slug.endsWith('free-addon'))?.kind).toBe('free-addon');
  });

  it('turns an add-on the channel prices above zero into a priced-addon that keeps its price and stays attached', () => {
    const catalog = CatalogBuilder.build({
      products: [entry({ add_ons: [{ _id: 'addon001', name: 'Paid Addon', single: [{ default_price: 25 }], variants: [] }] }, { _id: 'parent01', name: 'Parent Product' })],
    });

    const addon = Object.values(catalog.products).find((p) => p.slug.endsWith('paid-addon'));
    expect(addon?.kind).toBe('priced-addon');
    expect(addon?.variants?.[0].price_cents).toBe(2500);
    expect(Object.values(catalog.products).find((p) => p.slug.endsWith('parent-product'))?.attachments).toEqual([addon?.slug]);
  });

  it('keeps a lab\'s kind whatever it costs', () => {
    const catalog = CatalogBuilder.build({
      products: [entry({}, { labtest: [{ _id: 'lab001', name: 'Panel', single: [{ default_price: 40 }], variants: [] }] })],
    });

    expect(Object.values(catalog.products).find((p) => p.slug.endsWith('panel'))?.kind).toBe('lab');
  });

  it('extracts names from {_id, name} category objects and skips entries with no name', () => {
    const catalog = CatalogBuilder.build({
      products: [entry({}, { categories: [{ _id: 'c1', name: 'Weight Loss' }, { _id: 'c2' }] })],
    });

    expect(Object.values(catalog.products)[0].categories).toEqual(['Weight Loss']);
  });

  it('stamps the channel currency from the --currency argument, not from the EMR payload', () => {
    const catalog = CatalogBuilder.build({ _id: 'ch1', name: 'Channel One', products: [] }, 'EUR');
    expect(catalog.channel).toEqual({ id: 'ch1', name: 'Channel One', currency: 'EUR' });
  });
});
