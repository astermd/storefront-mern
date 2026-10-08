/**
 * Ported from storefront-lamp/core/Upsell/Upsell.php. One resolved post-purchase offer, ready to
 * render (Phase 8 builds the page that renders it — `Upsells.queueFor()` is what Phase 7's
 * `CheckoutService` needs today).
 */
export class Upsell {
  constructor(
    public readonly key: string,
    public readonly slug: string,
    public readonly variantId: string | null,
    public readonly eyebrow: string,
    public readonly headline: string,
    public readonly body: string,
    public readonly bullets: string[],
    public readonly image: string | null,
    public readonly acceptLabel: string,
    public readonly declineLabel: string,
    public readonly footnote: string | null,
    public readonly name: string,
    public readonly priceCents: number,
    public readonly providerOffer: string | null,
    public readonly providerItem: string | null,
    public readonly kind: string,
  ) {}
}
