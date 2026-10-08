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
