import { Injectable } from '@nestjs/common';
import { productsGenerated } from '../../config/products.generated';
import { productsOverrides } from '../../config/products.overrides';
import { CatalogProduct, ProductCatalog } from '../domain/product-catalog';
import { CatalogMerger } from './catalog-merger';

/**
 * Ported from storefront-lamp/core/Catalog/CatalogProvider.php — the only catalog class
 * controllers/`CartRules` touch at runtime, and the real `ProductCatalog` implementation Phase 4's
 * `EmptyProductCatalog` placeholder stood in for.
 *
 * The merge is computed once, at construction, rather than re-run per request: PHP memoizes it for
 * one request's lifetime because `Config` is read fresh each time; here `products.generated.ts`/
 * `products.overrides.ts` are static TS modules baked in at process start, so "once per request"
 * and "once per process" are the same guarantee.
 */
export interface CatalogChannel {
  id: string;
  name: string;
  currency: string;
}

@Injectable()
export class CatalogProvider implements ProductCatalog {
  private readonly merged: Record<string, CatalogProduct>;
  private readonly channelInfo: CatalogChannel;

  constructor(private readonly merger: CatalogMerger) {
    const merged = this.merger.merge(productsGenerated, productsOverrides);
    this.merged = merged.products;
    this.channelInfo = merged.channel;
  }

  /** The synced channel's own identity/currency (`[24.9]`'s structured-data offer reads this — a channel names no currency, no offer is published). */
  channel(): CatalogChannel {
    return this.channelInfo;
  }

  lastIgnoredOverrideIds(): string[] {
    return this.merger.lastIgnoredOverrideIds();
  }

  products(): CatalogProduct[] {
    return Object.values(this.merged);
  }

  /** `[6.1]`: only `rx`/`otc` — the surfaces a lab or free-addon product must never appear on. */
  listedProducts(): CatalogProduct[] {
    return this.products().filter((p) => p.kind === 'rx' || p.kind === 'otc');
  }

  product(slug: string): CatalogProduct | null {
    return this.merged[slug] ?? null;
  }

  /** Sorted, deduplicated category names across `listedProducts()` only. */
  categories(): string[] {
    const names = new Set<string>();
    for (const product of this.listedProducts()) {
      for (const category of product.categories ?? []) {
        names.add(category);
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }
}
