import { Inject, Injectable } from '@nestjs/common';
import { PRODUCT_CATALOG } from '../core/tokens';
import { CatalogProduct, ProductCatalog, ProductVariant } from '../domain/product-catalog';
import { ConfigService } from '../support/config';
import { OperatorLog } from '../support/operator-log';
import { UpsellRow } from '../../config/upsells';
import { Upsell } from './upsell';

/**
 * Ported from storefront-lamp/core/Upsell/Upsells.php. Which post-purchase upsells this journey
 * earned, in what order (§16).
 *
 * The queue is built **once**, at checkout success, from the slugs that were just purchased
 * (`[16.1]`) — `queueFor()` is what Phase 7's `CheckoutService` calls. `resolve()` turns one entry
 * into an offer at the moment it is about to be rendered (Phase 8), deliberately not consulted here:
 * an entry naming a product that has since disappeared stays in the queue and is skipped when
 * resolved, so the skip is visible in the operator log at the moment it costs a sale.
 */
@Injectable()
export class Upsells {
  private readonly byKey: Map<string, UpsellRow>;

  constructor(
    config: ConfigService,
    @Inject(PRODUCT_CATALOG) private readonly catalog: ProductCatalog,
    private readonly log: OperatorLog,
  ) {
    const rows = config.upsells?.upsells ?? {};
    this.byKey = new Map(Object.entries(rows));
  }

  /**
   * The keys this purchase earned, in configuration order (`[16.1]`, `[16.2]`), deduplicated: an
   * upsell earned by two purchased products is offered once.
   */
  queueFor(purchasedSlugs: string[]): string[] {
    const queue: string[] = [];

    for (const [key, row] of this.byKey) {
      const offerAfter = Array.isArray((row as { offer_after?: unknown }).offer_after) ? ((row as { offer_after: unknown[] }).offer_after as unknown[]) : [];
      if (offerAfter.some((trigger) => typeof trigger === 'string' && purchasedSlugs.includes(trigger))) {
        queue.push(key);
      }
    }

    return queue;
  }

  /** One entry as an offer, or null when it can no longer be made — logged rather than thrown, since this runs while a buyer is waiting. */
  resolve(key: string): Upsell | null {
    const row = this.byKey.get(key) as Record<string, unknown> | undefined;
    if (row === undefined) return null;

    const slug = typeof row.slug === 'string' ? row.slug.trim() : '';
    const product = slug === '' ? null : this.catalog.product(slug);

    if (product === null) {
      this.log.warning('upsell.unresolvable', { key, slug: slug === '' ? null : slug });
      return null;
    }

    const variant = row.variant_id;
    const variantId = typeof variant === 'string' && variant !== '' ? variant : null;
    const named = variantId === null ? null : Upsells.variantById(product, variantId);

    if (variantId !== null && named === null) {
      this.log.warning('upsell.unresolvable', { key, slug, variant_id: variantId });
      return null;
    }

    const override = row.price_cents_override;
    const priceCents = typeof override === 'number' ? override : named !== null ? (named.price_cents ?? 0) : (product.price_cents ?? 0);

    const provider = (named ?? Upsells.firstVariant(product))?.provider ?? null;

    const bullets = Array.isArray(row.bullets) ? row.bullets.filter((b): b is string => typeof b === 'string') : [];
    const image = typeof row.image === 'string' && row.image !== '' ? row.image : null;
    const name = product.name ?? slug;

    return new Upsell(
      key,
      slug,
      variantId,
      typeof row.eyebrow === 'string' ? row.eyebrow : '',
      Upsells.text(row.headline) ?? name,
      typeof row.body === 'string' ? row.body : '',
      bullets,
      image,
      Upsells.text(row.accept_label) ?? 'Add to Order',
      Upsells.text(row.decline_label) ?? 'No Thanks',
      Upsells.text(row.footnote),
      name,
      priceCents,
      provider?.offer_id ?? null,
      provider?.product_id ?? null,
      product.kind ?? 'otc',
    );
  }

  /** Every configured key, in configuration order. */
  keys(): string[] {
    return [...this.byKey.keys()];
  }

  private static variantById(product: CatalogProduct, variantId: string): ProductVariant | null {
    return (product.variants ?? []).find((v) => v.id === variantId) ?? null;
  }

  private static firstVariant(product: CatalogProduct): ProductVariant | null {
    return (product.variants ?? [])[0] ?? null;
  }

  private static text(value: unknown): string | null {
    return typeof value === 'string' && value.trim() !== '' ? value : null;
  }
}
