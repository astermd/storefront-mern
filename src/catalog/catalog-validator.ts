import { CatalogProduct } from '../domain/product-catalog';

const ALLOWED_KINDS = ['rx', 'otc', 'lab', 'free-addon', 'priced-addon'];

export interface CatalogValidation {
  errors: string[];
  warnings: string[];
}

/**
 * Ported from storefront-lamp/core/Catalog/CatalogValidator.php. Pure structural pass over a
 * merged catalog (the shape `CatalogBuilder`/`CatalogMerger` produce). No I/O — `validate()` is a
 * deterministic function of its argument. The live EMR-resolution pass (`--live`) belongs to
 * `config:validate` instead, since it needs a real client — not ported here (it exempts `lab`,
 * `free-addon` and `priced-addon` products, which are not sold as standalone EMR products).
 *
 * Two input shapes are tolerated on purpose: a full sync catalog (`{channel, products}`, the shape
 * `CatalogBuilder.build()` emits) and the legacy example-seed shape (`{products}` only, individual
 * products that may have no `variants` key at all). A missing `variants` key is tolerated as a
 * legacy-seed product (warning, not error); an explicit `variants` key whose list is empty is NOT
 * tolerated (error) because it means something upstream produced a product nobody can actually buy.
 */
export class CatalogValidator {
  validate(catalog: { channel?: unknown; products?: Record<string, CatalogProduct | undefined> }): CatalogValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!('channel' in catalog)) {
      warnings.push('channel key absent');
    }

    this.validateCurrency(catalog, errors);

    const products = catalog.products ?? {};
    const knownSlugs = CatalogValidator.knownSlugs(products);

    for (const [key, product] of Object.entries(products)) {
      if (!product || typeof product !== 'object') {
        errors.push(`product ${key}: not an array`);
        continue;
      }

      const ref = CatalogValidator.ref(product, key);

      this.validateRequiredFields(product, ref, errors);
      this.validateKind(product, ref, errors);
      this.validateBundlesAndAttachments(product, ref, knownSlugs, errors);
      this.validateVariants(product, ref, errors, warnings);
    }

    return { errors, warnings };
  }

  private validateCurrency(catalog: { channel?: unknown }, errors: string[]): void {
    const channel = (catalog.channel && typeof catalog.channel === 'object' ? catalog.channel : {}) as Record<string, unknown>;

    if (!('currency' in channel)) return;

    const currency = channel.currency;
    if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
      errors.push(`channel currency "${typeof currency === 'string' || typeof currency === 'number' || typeof currency === 'boolean' ? String(currency) : typeof currency}" is not a 3-letter uppercase ISO code`);
    }
  }

  private validateRequiredFields(product: CatalogProduct, ref: string, errors: string[]): void {
    for (const field of ['slug', 'name', 'kind'] as const) {
      const value = product[field];
      if (typeof value !== 'string' || value.trim() === '') {
        errors.push(`product ${ref}: missing/blank or invalid required field "${field}"`);
      }
    }
  }

  private validateKind(product: CatalogProduct, ref: string, errors: string[]): void {
    const kind = product.kind;
    // A missing/blank kind is already reported by validateRequiredFields(); only a present,
    // non-blank string that isn't one of the allowed values needs a second error here.
    if (typeof kind === 'string' && kind.trim() !== '' && !ALLOWED_KINDS.includes(kind)) {
      errors.push(`product ${ref}: kind "${kind}" is not one of ${ALLOWED_KINDS.join(', ')}`);
    }
  }

  private validateBundlesAndAttachments(product: CatalogProduct, ref: string, knownSlugs: Set<string>, errors: string[]): void {
    for (const field of ['bundles', 'attachments'] as const) {
      for (const slugRef of product[field] ?? []) {
        if (typeof slugRef !== 'string' || !knownSlugs.has(slugRef)) {
          errors.push(`product ${ref}: ${field} slug "${typeof slugRef === 'string' ? slugRef : typeof slugRef}" resolves to no product`);
        }
      }
    }
  }

  private validateVariants(product: CatalogProduct, ref: string, errors: string[], warnings: string[]): void {
    if (!('variants' in product)) {
      warnings.push(`product ${ref}: legacy-seed product lacks variants`);
      return;
    }

    const variants = product.variants;
    if (!Array.isArray(variants)) {
      errors.push(`product ${ref}: variants must be a list`);
      return;
    }

    if (variants.length === 0) {
      errors.push(`product ${ref}: variants list is empty`);
      return;
    }

    const missingProviderNames: string[] = [];
    const prices: number[] = [];

    for (const variant of variants) {
      if (!variant || typeof variant !== 'object') {
        errors.push(`product ${ref}: variant entry is not an array`);
        continue;
      }

      const variantLabel = typeof variant.name === 'string' && variant.name !== '' ? variant.name : String(variant.id ?? '?');

      const price = variant.price_cents;
      if (typeof price !== 'number' || !Number.isInteger(price) || price < 0) {
        errors.push(`product ${ref}: variant "${variantLabel}" price_cents is not a non-negative int`);
      } else {
        prices.push(price);
      }

      if ((variant.provider ?? null) === null) {
        missingProviderNames.push(variantLabel);
      }
    }

    if (missingProviderNames.length > 0) {
      warnings.push(`product ${ref}: ${missingProviderNames.length} variant(s) need provider identifiers in the override layer — ${missingProviderNames.join(', ')}`);
    }

    if (new Set(prices).size > 1) {
      warnings.push(`product ${ref}: variants differ in price — verify prices vary by plan length only, never by dose (spec [29.3])`);
    }
  }

  /** The identifier used in messages for a product: its own `slug` field when present, else its map key. */
  private static ref(product: CatalogProduct, key: string): string {
    return typeof product.slug === 'string' && product.slug !== '' ? product.slug : key;
  }

  /** Every slug a `bundles`/`attachments` entry could legitimately resolve to. */
  private static knownSlugs(products: Record<string, CatalogProduct | undefined>): Set<string> {
    const slugs = new Set<string>();
    for (const [key, product] of Object.entries(products)) {
      if (product && typeof product === 'object') {
        slugs.add(CatalogValidator.ref(product, key));
      }
    }
    return slugs;
  }
}
