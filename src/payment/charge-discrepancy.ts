/**
 * Ported from storefront-lamp/core/Payment/ChargeDiscrepancy.php. Attached to a *placed* outcome,
 * never a decline — by the time it's measurable the card is already charged, so it can't turn
 * into a refusal to record.
 */
export class ChargeDiscrepancy {
  constructor(
    public readonly expectedCents: number,
    public readonly chargedCents: number,
    public readonly providerDiscountCents: number | null = null,
  ) {}

  /** Positive = overcharged. */
  differenceCents(): number {
    return this.chargedCents - this.expectedCents;
  }
}
