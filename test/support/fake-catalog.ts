import { CatalogProduct, ProductCatalog } from '../../src/domain/product-catalog';

/**
 * In-memory `ProductCatalog` for tests — the direct equivalent of the fixture catalogs
 * storefront-lamp's own `CartRulesTest` builds. `CartRules`/`FunnelRules` are pure code over this
 * port, so exercising them needs no real catalog data source (Phase 5).
 */
export class FakeCatalog implements ProductCatalog {
  private readonly products = new Map<string, CatalogProduct>();

  constructor(products: CatalogProduct[] = []) {
    for (const product of products) {
      this.products.set(product.slug, product);
    }
  }

  add(product: CatalogProduct): this {
    this.products.set(product.slug, product);
    return this;
  }

  product(slug: string): CatalogProduct | null {
    return this.products.get(slug) ?? null;
  }
}
