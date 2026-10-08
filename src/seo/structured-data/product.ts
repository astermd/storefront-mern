import { CatalogProduct, ProductVariant } from '../../domain/product-catalog';
import { Emitter } from './emitter';

/**
 * Ported from storefront-lamp/core/Seo/StructuredData/Product.php. One catalog product as
 * schema.org `Product` with its offer (`[24.8]`).
 *
 * **`[24.9]` — the offer reflects real state.** The price is the *resolved variant's*, never the
 * product-level `price_cents` — variants are the plans a visitor actually buys, so the
 * product-level figure is a summary no checkout ever charges. Availability is derived the same
 * way: a variant with no provider mapping cannot be ordered, so it is published as out of stock
 * rather than as an offer nothing can fulfil.
 *
 * **`[24.10]` — a prescription product defaults to publishing nothing.** Claims and availability
 * constraints for an `rx` product vary by jurisdiction and by client, so this emitter returns null
 * for one unless the deployment has decided its own territory allows it.
 *
 * Money is integer cents everywhere inside this application; schema.org's `price` is a decimal
 * string, converted by integer division in `decimal()` rather than by dividing a float, so no
 * rounding step sits between the cents the checkout charges and the price a crawler reads.
 */
export class Product implements Emitter {
  static readonly IN_STOCK = 'https://schema.org/InStock';
  static readonly OUT_OF_STOCK = 'https://schema.org/OutOfStock';

  /**
   * @param description already resolved through the `[24.4]` chain; blank means "publish no description key"
   * @param currency the catalog channel's currency; null means the offer cannot be stated
   */
  constructor(
    private readonly product: CatalogProduct,
    private readonly canonical: string,
    private readonly baseUrl: string,
    private readonly description: string,
    private readonly brand: string,
    private readonly currency: string | null,
    private readonly prescriptionPermitted: boolean,
  ) {}

  emit(): Record<string, unknown> | null {
    if (this.isPrescription() && !this.prescriptionPermitted) {
      return null;
    }

    const node: Record<string, unknown> = {
      '@type': 'Product',
      '@id': `${this.canonical}#product`,
      name: (this.product.name ?? '').trim(),
      url: this.canonical,
    };

    const images = this.images();
    if (images.length > 0) node.image = images;

    // Never an empty key: every product this EMR syncs carries an empty description.
    if (this.description.trim() !== '') node.description = this.description;

    if (this.brand.trim() !== '') node.brand = { '@type': 'Brand', name: this.brand.trim() };

    const category = this.category();
    if (category !== null) node.category = category;

    const offer = this.offer();
    if (offer !== null) node.offers = offer;

    return node;
  }

  /** Whether this product is dispensed on prescription (`[24.10]`). */
  isPrescription(): boolean {
    return this.product.kind === 'rx';
  }

  /** The offer, or null when this deployment cannot state one truthfully — a missing currency is the only such case. */
  private offer(): Record<string, unknown> | null {
    if (this.currency === null) return null;

    const variant = this.resolvedVariant();
    const cents = this.priceCents(variant);

    return {
      '@type': 'Offer',
      url: this.canonical,
      price: Product.decimal(cents),
      priceCurrency: this.currency,
      availability: this.orderable(variant) ? Product.IN_STOCK : Product.OUT_OF_STOCK,
    };
  }

  /** The variant whose price is the one a visitor is quoted: the first, the same one every listing surface prices from (`[24.9]`). */
  private resolvedVariant(): ProductVariant | null {
    return (this.product.variants ?? [])[0] ?? null;
  }

  private priceCents(variant: ProductVariant | null): number {
    if (variant !== null && typeof variant.price_cents === 'number') {
      return variant.price_cents;
    }
    // Only reachable for a product with no variants, where the product-level figure is the price.
    return typeof this.product.price_cents === 'number' ? this.product.price_cents : 0;
  }

  /** Whether the resolved variant can actually be bought — a variant carries the provider's offer and product identifiers or it cannot be placed as an order. */
  private orderable(variant: ProductVariant | null): boolean {
    const provider = variant?.provider;
    return !!provider && (provider.offer_id ?? '').trim() !== '' && (provider.product_id ?? '').trim() !== '';
  }

  /** Absolute image URLs, the primary one first, deduplicated. */
  private images(): string[] {
    const seen = new Set<string>();
    for (const path of [this.product.image, ...(this.product.gallery ?? [])]) {
      if (typeof path !== 'string' || path.trim() === '') continue;
      seen.add(this.absolute(path.trim()));
    }
    return [...seen];
  }

  private category(): string | null {
    for (const category of this.product.categories ?? []) {
      if (typeof category === 'string' && category.trim() !== '') return category.trim();
    }
    return null;
  }

  private absolute(path: string): string {
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    return `${this.baseUrl}/${path.replace(/^\/+/, '')}`;
  }

  /** Integer cents as the decimal string schema.org's `price` requires — integer arithmetic, never `cents / 100`, so no float rounding sits between what is charged and what is published. */
  static decimal(cents: number): string {
    const sign = cents < 0 ? '-' : '';
    const abs = Math.abs(cents);
    return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  }
}
