import { CartLineData } from '../journey/journey-state';

/**
 * Ported from storefront-lamp/core/Domain/CartLine.php. One line of the cart: a product, a
 * quantity, a resolved price, optionally a chosen variant and a parent link (`[1.1]`, `[1.5]`).
 *
 * Identity (`slug`/`name`/`kind`/`emrProductId`/`parentSlug`) is set once at construction; the
 * three mutable fields (`quantity`/`unitPriceCents`/`variantId`) are the three `CartRules` is
 * allowed to change — which is what lets a plan choice re-price a line (`[12.4]`) without
 * rebuilding it and losing its parent link.
 */
export class CartLine {
  quantity: number;
  unitPriceCents: number;
  variantId: string | null;

  constructor(
    readonly slug: string,
    readonly name: string,
    readonly kind: string,
    readonly emrProductId: string | null,
    readonly parentSlug: string | null,
    quantity = 1,
    unitPriceCents = 0,
    variantId: string | null = null,
  ) {
    this.quantity = quantity;
    this.unitPriceCents = unitPriceCents;
    this.variantId = variantId;
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
    );
  }
}
