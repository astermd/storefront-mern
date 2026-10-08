import { Inject, Injectable } from '@nestjs/common';
import { PRODUCT_CATALOG } from '../core/tokens';
import { Cart } from '../domain/cart';
import { CatalogProduct, ProductCatalog } from '../domain/product-catalog';
import { ConfigService } from '../support/config';
import { OperatorLog } from '../support/operator-log';
import { OrderBump } from './order-bump';

export interface CrossSellBumpRow {
  key?: unknown;
  slug?: unknown;
  variant_id?: unknown;
  headline?: unknown;
  body?: unknown;
  position?: unknown;
  price_cents_override?: unknown;
}

/**
 * Ported from storefront-lamp/core/Checkout/OrderBumps.php. Which bumps this cart earns, in what
 * order (§27).
 *
 * Deciding is pure: this class answers "what should the page offer", and accepting an offer goes
 * through `CartRules` like any other add (`[27.11]`), so a bump's own supply attachments come along
 * and the geo gate applies to it. Bumps re-evaluate every time the page renders (`[27.14]`). A
 * configured maximum renders and the remainder are dropped in position order (`[27.8]`), logged
 * rather than silently truncated.
 */
@Injectable()
export class OrderBumps {
  private readonly byTrigger: Record<string, CrossSellBumpRow[]>;
  private readonly maxOnPage: number;

  constructor(
    config: ConfigService,
    @Inject(PRODUCT_CATALOG) private readonly catalog: ProductCatalog,
    private readonly log: OperatorLog,
  ) {
    this.byTrigger = config.crossSells.byTrigger as unknown as Record<string, CrossSellBumpRow[]>;
    this.maxOnPage = Math.max(0, config.crossSells.maxOnPage);
  }

  offeredFor(cart: Cart, territory: string): OrderBump[] {
    const candidates = new Map<string, OrderBump>();

    for (const line of cart.lines()) {
      for (const row of this.byTrigger[line.slug] ?? []) {
        const bump = this.resolve(row);
        if (bump === null) continue;

        if (candidates.has(bump.key)) continue;
        if (cart.has(bump.slug)) continue;
        if (this.blockedIn(bump.slug, territory)) continue;

        candidates.set(bump.key, bump);
      }
    }

    const ordered = [...candidates.values()].sort((a, b) => a.position - b.position);

    if (ordered.length <= this.maxOnPage) return ordered;

    const kept = ordered.slice(0, this.maxOnPage);
    const dropped = ordered.slice(this.maxOnPage);

    this.log.info('checkout.bumps_truncated', { max: this.maxOnPage, dropped: dropped.map((b) => b.slug) });

    return kept;
  }

  private resolve(row: CrossSellBumpRow): OrderBump | null {
    const slug = typeof row.slug === 'string' ? row.slug.trim() : '';
    const product = slug === '' ? null : this.catalog.product(slug);

    if (product === null) {
      this.log.warning('checkout.bump_unresolvable', { slug: slug === '' ? null : slug });
      return null;
    }

    const override = row.price_cents_override;
    const variantId = typeof row.variant_id === 'string' && row.variant_id !== '' ? row.variant_id : null;

    const catalogPrice = variantId === null ? (product.price_cents ?? 0) : OrderBumps.variantPrice(product, variantId);

    if (catalogPrice === null) {
      this.log.warning('checkout.bump_unresolvable', { slug, variant_id: variantId });
      return null;
    }

    return new OrderBump(
      typeof row.key === 'string' && row.key !== '' ? row.key : slug,
      slug,
      variantId,
      typeof row.headline === 'string' ? row.headline : (product.name ?? slug),
      typeof row.body === 'string' ? row.body : '',
      typeof row.position === 'number' ? row.position : Number.MAX_SAFE_INTEGER,
      typeof override === 'number' ? override : null,
      product.name ?? slug,
      catalogPrice,
    );
  }

  private static variantPrice(product: CatalogProduct, variantId: string): number | null {
    for (const variant of product.variants ?? []) {
      if (variant.id === variantId) return variant.price_cents ?? 0;
    }
    return null;
  }

  private blockedIn(slug: string, territory: string): boolean {
    const product = this.catalog.product(slug);
    const blocks = product?.geo_blocks ?? [];
    return blocks.map((t) => t.toUpperCase()).includes(territory.toUpperCase());
  }
}
