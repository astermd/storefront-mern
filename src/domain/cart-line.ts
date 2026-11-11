import { CartLineData } from '../journey/journey-state';

/**
 * Ported from storefront-lamp/core/Domain/CartLine.php. One line of the cart: a product, a
 * quantity, a resolved price, optionally a chosen variant, the subscription plan it is sold on, and
 * a parent link (`[1.1]`, `[1.5]`).
 *
 * Identity (`slug`/`name`/`kind`/`emrProductId`/`parentSlug`) is set once at construction; the
 * four mutable fields (`quantity`/`unitPriceCents`/`variantId`/`planId`) are the four `CartRules`
 * is allowed to change — which is what lets a variant or subscription choice re-price a line
 * (`[12.4]`) without rebuilding it and losing its parent link.
 *
 * `planId` is the EMR plan the buyer chose among the ones its variant is sold on (`VariantPlans`);
 * null for a variant sold one-off, and for a line stored before plans could be chosen, which is then
 * on its variant's default plan exactly as it was.
 */
export class CartLine {
  quantity: number;
  unitPriceCents: number;
  variantId: string | null;
  planId: string | null;

  constructor(
    readonly slug: string,
    readonly name: string,
    readonly kind: string,
    readonly emrProductId: string | null,
    readonly parentSlug: string | null,
    quantity = 1,
    unitPriceCents = 0,
    variantId: string | null = null,
    planId: string | null = null,
  ) {
    this.quantity = quantity;
    this.unitPriceCents = unitPriceCents;
    this.variantId = variantId;
    this.planId = planId;
  }

  isChild(): boolean {
    return this.parentSlug !== null;
  }

  lineTotalCents(): number {
    return this.quantity * this.unitPriceCents;
  }

  toArray(): CartLineData {
    return {
      slug: this.slug,
      name: this.name,
      kind: this.kind,
      emr_product_id: this.emrProductId,
      parent_slug: this.parentSlug,
      quantity: this.quantity,
      unit_price_cents: this.unitPriceCents,
      variant_id: this.variantId,
      plan_id: this.planId,
    };
  }

  static fromArray(data: Partial<CartLineData>): CartLine {
    return new CartLine(
      data.slug ?? '',
      data.name ?? '',
      data.kind ?? 'otc',
      data.emr_product_id ?? null,
      data.parent_slug ? data.parent_slug : null,
      Math.max(1, data.quantity ?? 1),
      data.unit_price_cents ?? 0,
      data.variant_id ? data.variant_id : null,
      typeof data.plan_id === 'string' && data.plan_id !== '' ? data.plan_id : null,
    );
  }
}
