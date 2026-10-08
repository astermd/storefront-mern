import { CatalogProduct, ProductVariant } from '../src/domain/product-catalog';

/**
 * Ported from storefront-lamp/config/products.overrides.php — client-owned, never written by
 * `theme:sync`. Keyed by `emr_product_id` (never slug), merged over `products.generated.ts` by
 * `CatalogMerger`. Empty by default; a deployment adds `geo_blocks`, `requires_prequalification`,
 * per-variant price corrections, or a wholly net-new product here.
 */
/**
 * `variants` takes either shape, disambiguated at runtime by `CatalogMerger` (`Array.isArray`):
 * a record keyed by variant id (per-field merge into an *existing* product's variants), or a full
 * array (a wholly net-new product definition — `CatalogMerger.isFullDefinition()`'s shape).
 */
export type ProductOverride = Omit<Partial<CatalogProduct>, 'variants'> & {
  variants?: Record<string, Partial<ProductVariant>> | ProductVariant[];
};

export interface ProductsOverrides {
  products: Record<string, ProductOverride>;
}

export const productsOverrides: ProductsOverrides = {
  products: {},
};
