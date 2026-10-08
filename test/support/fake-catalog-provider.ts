import { CatalogChannel } from '../../src/catalog/catalog-provider';
import { CatalogProduct } from '../../src/domain/product-catalog';

/**
 * A test double for the concrete `CatalogProvider` class — not just the `ProductCatalog` interface
 * `PRODUCT_CATALOG` resolves to. `ProductDetailController` (and a few other spots) inject
 * `CatalogProvider` directly rather than through the token, so an e2e test overriding only
 * `PRODUCT_CATALOG` leaves those call sites reading the real generated example catalog. Overriding
 * `CatalogProvider` itself (which `PRODUCT_CATALOG`'s `useExisting` binding also resolves through)
 * covers both.
 */
export class FakeCatalogProvider {
  private readonly byslug = new Map<string, CatalogProduct>();
  private readonly channelInfo: CatalogChannel;

  constructor(products: CatalogProduct[] = [], channel: CatalogChannel = { id: 'test-channel', name: 'Test Channel', currency: 'USD' }) {
    for (const product of products) {
      this.byslug.set(product.slug, product);
    }
    this.channelInfo = channel;
  }

  channel(): CatalogChannel {
    return this.channelInfo;
  }

  product(slug: string): CatalogProduct | null {
    return this.byslug.get(slug) ?? null;
  }

  products(): CatalogProduct[] {
    return [...this.byslug.values()];
  }

  listedProducts(): CatalogProduct[] {
    return this.products().filter((p) => p.kind === 'rx' || p.kind === 'otc');
  }

  categories(): string[] {
    const names = new Set<string>();
    for (const product of this.listedProducts()) {
      for (const category of product.categories ?? []) names.add(category);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }

  lastIgnoredOverrideIds(): string[] {
    return [];
  }
}
