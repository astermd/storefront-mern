import { CatalogProvider } from '../../src/catalog/catalog-provider';
import { MetaResolver } from '../../src/seo/meta-resolver';
import { StructuredData } from '../../src/seo/structured-data/structured-data';
import { ConfigService } from '../../src/support/config';
import { FakeCatalogProvider } from '../support/fake-catalog-provider';

describe('StructuredData', () => {
  function build(overrides: { structuredData?: Partial<ConfigService['app']['seo']['structuredData']>; url?: string }, catalog: FakeCatalogProvider): StructuredData {
    const config = new ConfigService();
    const patched = {
      ...config,
      app: {
        ...config.app,
        url: overrides.url ?? 'https://example.com',
        seo: { ...config.app.seo, structuredData: { ...config.app.seo.structuredData, ...(overrides.structuredData ?? {}) } },
      },
    } as unknown as ConfigService;

    const meta = new MetaResolver(patched);
    return new StructuredData(patched, catalog as unknown as CatalogProvider, meta);
  }

  it('publishes nothing when every emitter is switched off', () => {
    const structuredData = build({ structuredData: { organisation: false, website: false, product: false, breadcrumbs: false, rx: false } }, new FakeCatalogProvider());

    expect(structuredData.json('/')).toBeNull();
    expect(structuredData.nodesFor('/')).toEqual([]);
  });

  it('publishes Organization and WebSite on the home page when enabled', () => {
    const structuredData = build({ structuredData: { organisation: true, website: true, product: false, breadcrumbs: false, rx: false } }, new FakeCatalogProvider());

    const nodes = structuredData.nodesFor('/');
    const types = nodes.map((n) => n['@type']);
    expect(types).toEqual(['Organization', 'WebSite']);

    const website = nodes[1] as Record<string, unknown>;
    expect((website.publisher as Record<string, unknown>)['@id']).toBe('https://example.com/#organisation');
  });

  it('publishes a Product node with an offer priced from the resolved (first) variant, never the product-level price', () => {
    const catalog = new FakeCatalogProvider(
      [
        {
          slug: 'widget',
          name: 'Widget',
          kind: 'otc',
          price_cents: 4600,
          variants: [{ id: 'v1', name: 'Standard', price_cents: 5000, provider: { offer_id: 'o1', product_id: 'p1' } }],
        },
      ],
      { id: 'c1', name: 'Channel', currency: 'usd' },
    );
    const structuredData = build({ structuredData: { organisation: false, website: false, product: true, breadcrumbs: false, rx: false } }, catalog);

    const nodes = structuredData.nodesFor('/products/widget/');
    expect(nodes).toHaveLength(1);
    const offer = nodes[0].offers as Record<string, unknown>;
    expect(offer.price).toBe('50.00');
    expect(offer.priceCurrency).toBe('USD');
    expect(offer.availability).toBe('https://schema.org/InStock');
  });

  it('marks an unmapped variant as out of stock rather than omitting the offer', () => {
    const catalog = new FakeCatalogProvider(
      [{ slug: 'widget', name: 'Widget', kind: 'otc', variants: [{ id: 'v1', name: 'Standard', price_cents: 1000 }] }],
      { id: 'c1', name: 'Channel', currency: 'USD' },
    );
    const structuredData = build({ structuredData: { organisation: false, website: false, product: true, breadcrumbs: false, rx: false } }, catalog);

    const offer = structuredData.nodesFor('/products/widget/')[0].offers as Record<string, unknown>;
    expect(offer.availability).toBe('https://schema.org/OutOfStock');
  });

  it('publishes nothing for an rx product unless the deployment explicitly permits it, and its breadcrumb trail is withheld too', () => {
    const catalog = new FakeCatalogProvider([{ slug: 'rx-item', name: 'Rx Item', kind: 'rx', variants: [{ id: 'v1', name: 'Plan', price_cents: 1000 }] }], {
      id: 'c1',
      name: 'Channel',
      currency: 'USD',
    });

    const refused = build({ structuredData: { organisation: false, website: false, product: true, breadcrumbs: true, rx: false } }, catalog);
    expect(refused.nodesFor('/products/rx-item/')).toEqual([]);

    const permitted = build({ structuredData: { organisation: false, website: false, product: true, breadcrumbs: true, rx: true } }, catalog);
    const nodes = permitted.nodesFor('/products/rx-item/');
    expect(nodes.some((n) => n['@type'] === 'Product')).toBe(true);
    expect(nodes.some((n) => n['@type'] === 'BreadcrumbList')).toBe(true);
  });

  it('publishes no offer at all when the catalog channel names no currency', () => {
    const catalog = new FakeCatalogProvider([{ slug: 'widget', name: 'Widget', kind: 'otc', variants: [{ id: 'v1', name: 'Standard', price_cents: 1000 }] }], {
      id: 'c1',
      name: 'Channel',
      currency: '',
    });
    const structuredData = build({ structuredData: { organisation: false, website: false, product: true, breadcrumbs: false, rx: false } }, catalog);

    const node = structuredData.nodesFor('/products/widget/')[0];
    expect(node.offers).toBeUndefined();
  });

  it('does not publish a BreadcrumbList for the home page — a trail of one crumb is not a trail', () => {
    const structuredData = build({ structuredData: { organisation: false, website: false, product: false, breadcrumbs: true, rx: false } }, new FakeCatalogProvider());

    expect(structuredData.nodesFor('/')).toEqual([]);
  });

  it('escapes < and & in the encoded JSON so a catalog string cannot close the embedding <script> tag', () => {
    const catalog = new FakeCatalogProvider(
      [{ slug: 'widget', name: 'Widget</script><script>alert(1)</script>', kind: 'otc', variants: [{ id: 'v1', name: 'Standard', price_cents: 1000, provider: { offer_id: 'o', product_id: 'p' } }] }],
      { id: 'c1', name: 'Channel', currency: 'USD' },
    );
    const structuredData = build({ structuredData: { organisation: false, website: false, product: true, breadcrumbs: false, rx: false } }, catalog);

    const json = structuredData.json('/products/widget/');
    expect(json).not.toBeNull();
    expect(json).not.toContain('</script>');
    expect(json).not.toContain('<');
  });
});
