/**
 * Ported from storefront-lamp/core/Payment/OrderLine.php. One priced line in an order sent to the
 * payment provider.
 */
export class OrderLine {
  constructor(
    public readonly slug: string,
    public readonly name: string,
    public readonly providerOffer: string | null,
    public readonly providerItem: string | null,
    public readonly unitPriceCents: number,
    public readonly quantity: number,
    public readonly kind: string = 'otc',
    /**
     * The EMR's own product id, and its variant id (the product id for a product without variants).
     * A provider whose order is read back by the EMR names the line by these.
     */
    public readonly emrProductId: string | null = null,
    public readonly emrVariantId: string | null = null,
    /** The EMR subscription plan the line is sold on, when it is sold on one; such a line is named by the plan alone. */
    public readonly planId: string | null = null,
  ) {}

  lineTotalCents(): number {
    return this.unitPriceCents * this.quantity;
  }

  isFree(): boolean {
    return this.unitPriceCents === 0;
  }

  /** Both provider identifiers must be present and non-empty for this line to actually be sent to the provider. */
  isChargeable(): boolean {
    return this.providerOffer !== null && this.providerOffer !== '' && this.providerItem !== null && this.providerItem !== '';
  }
}
