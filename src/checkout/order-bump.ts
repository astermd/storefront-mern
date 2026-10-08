/** Ported from storefront-lamp/core/Checkout/OrderBump.php. */
export class OrderBump {
  constructor(
    public readonly key: string,
    public readonly slug: string,
    public readonly variantId: string | null,
    public readonly headline: string,
    public readonly body: string,
    public readonly position: number,
    public readonly priceCentsOverride: number | null,
    public readonly name: string,
    public readonly catalogPriceCents: number,
  ) {}

  priceCents(): number {
    return this.priceCentsOverride ?? this.catalogPriceCents;
  }
}
