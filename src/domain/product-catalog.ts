/**
 * Ported from storefront-lamp/core/Domain/ProductCatalog.php. The single read the cart/funnel
 * rules make against the catalog — declared as a port so the domain layer stays free of I/O and
 * of the config cascade: the rules are exercised against an in-memory implementation in their own
 * tests, and `CatalogProvider` (Phase 5) satisfies it in production without either side knowing
 * about the other.
 *
 * `ProductVariant`/`CatalogProduct` are typed here (the PHP original passes untyped associative
 * arrays) since TypeScript makes that free. Phase 4 only needed the fields `CartRules`/
 * `FunnelRules` read; Phase 5 adds everything the catalog/product-page templates display
 * (`subtitle`, `categories`, `description`, `image`, `gallery`, `badges`, `price_unit`, ...) —
 * matching the shape `CatalogBuilder::build()`'s output and `products.generated.example.php`
 * document on the PHP side.
 */
export interface ProductVariant {
  id: string;
  name: string;
  price_cents: number;
  provider?: { offer_id: string; product_id: string } | null;
}

export interface ProductBadge {
  label: string;
  variant: 'primary' | 'secondary';
}

export interface CatalogProduct {
  slug: string;
  name: string;
  kind: string;
  subtitle?: string | null;
  categories?: string[];
  condition_treated?: string[];
  description?: string;
  price_cents?: number;
  price_unit?: string | null;
  image?: string;
  gallery?: string[];
  badges?: ProductBadge[];
  emr_product_id?: string | null;
  remote_image?: string | null;
  teleform_id?: string;
  max_buy_qty?: number;
  min_buy_qty?: number;
  restrict_multiple?: boolean;
  variants?: ProductVariant[];
  bundles?: string[];
  attachments?: string[];
  /** Override-only fields — never emitted by CatalogBuilder, only ever set via products.overrides. */
  geo_blocks?: string[];
  requires_prequalification?: boolean;
  prequalification_teleform_id?: string;
  /** Checkout-time concern (Phase 7) — carried in the type now since it's part of the override shape. */
  settlement?: 'authorize' | 'capture';
}

export interface ProductCatalog {
  /** The merged product for `slug`, or null when no product has that slug. */
  product(slug: string): CatalogProduct | null;
}
