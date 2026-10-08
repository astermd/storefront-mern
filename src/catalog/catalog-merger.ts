import { Injectable } from '@nestjs/common';
import { GeneratedCatalog } from '../../config/products.generated';
import { ProductOverride, ProductsOverrides } from '../../config/products.overrides';
import { CatalogProduct, ProductVariant } from '../domain/product-catalog';

/**
 * Ported from storefront-lamp/core/Catalog/CatalogMerger.php. Layers `products.overrides.ts` over
 * `products.generated.ts`. Matching key is **`emr_product_id`**, never slug/name — a client
 * renames a product without losing its overrides.
 *
 * Every override field except `variants` replaces wholesale (no deep merge). `variants` overrides
 * are keyed by variant id and merge per-field into just that variant; unmentioned variants/fields
 * are untouched. Setting `slug` in an override re-keys the product in the result map. An override
 * id matching no generated product is either added as net-new (if it's a full product definition —
 * `slug`/`name`/`kind`/`variants` all present) or silently ignored and recorded in
 * `lastIgnoredOverrideIds()`.
 */
@Injectable()
export class CatalogMerger {
  private ignoredOverrideIds: string[] = [];

  merge(generated: GeneratedCatalog, overrides: ProductsOverrides): GeneratedCatalog {
    this.ignoredOverrideIds = [];

    const bySlug = new Map<string, CatalogProduct>();
    const slugByEmrId = new Map<string, string>();

    for (const product of Object.values(generated.products)) {
      this.insertProduct(bySlug, slugByEmrId, product);
    }

    for (const [emrProductId, overrideData] of Object.entries(overrides.products ?? {})) {
      const existingSlug = slugByEmrId.get(emrProductId);

      if (existingSlug === undefined) {
        if (CatalogMerger.isFullDefinition(overrideData)) {
          this.insertProduct(bySlug, slugByEmrId, CatalogMerger.asNetNewProduct(overrideData, emrProductId), emrProductId);
        } else {
          this.ignoredOverrideIds.push(emrProductId);
        }
        continue;
      }

      const existing = bySlug.get(existingSlug);
      if (!existing) continue;

      const { variants: variantOverrides, ...rest } = overrideData;
      const merged: CatalogProduct = { ...existing, ...rest };

      // The record-keyed shape merges into an *existing* product's variants (an array here would
      // only ever appear on a net-new definition, handled above — the array branch is defensive).
      if (variantOverrides && !Array.isArray(variantOverrides)) {
        const matchedIds = new Set<string>();
        merged.variants = (existing.variants ?? []).map((variant) => {
          const override = variantOverrides[variant.id];
          if (!override) return variant;
          matchedIds.add(variant.id);
          return { ...variant, ...override } as ProductVariant;
        });

        for (const variantId of Object.keys(variantOverrides)) {
          if (!matchedIds.has(variantId)) {
            this.ignoredOverrideIds.push(`${emrProductId}:${variantId}`);
          }
        }
      }

      if (existingSlug !== merged.slug) {
        bySlug.delete(existingSlug);
        slugByEmrId.set(emrProductId, merged.slug);
      }

      if (bySlug.has(merged.slug) && bySlug.get(merged.slug) !== existing) {
        throw new Error(`Duplicate product slug "${merged.slug}" produced while merging overrides.`);
      }
      bySlug.set(merged.slug, merged);
    }

    return { channel: generated.channel, products: Object.fromEntries(bySlug) };
  }

  /** Call right after `merge()` — ids from `products.overrides.ts` that matched nothing real. */
  lastIgnoredOverrideIds(): string[] {
    return this.ignoredOverrideIds;
  }

  private insertProduct(
    bySlug: Map<string, CatalogProduct>,
    slugByEmrId: Map<string, string>,
    product: CatalogProduct,
    emrProductIdOverride?: string,
  ): void {
    if (bySlug.has(product.slug)) {
      throw new Error(`Duplicate product slug "${product.slug}".`);
    }
    bySlug.set(product.slug, product);

    const emrProductId = emrProductIdOverride ?? product.emr_product_id;
    if (emrProductId) {
      slugByEmrId.set(emrProductId, product.slug);
    }
  }

  private static isFullDefinition(data: ProductOverride): data is CatalogProduct {
    return typeof data.slug === 'string' && typeof data.name === 'string' && typeof data.kind === 'string' && Array.isArray(data.variants);
  }

  private static asNetNewProduct(data: CatalogProduct, emrProductId: string): CatalogProduct {
    return { emr_product_id: emrProductId, ...data };
  }
}
