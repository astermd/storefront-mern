/**
 * Ported from storefront-lamp/core/Payment/ProviderOrder.php. Deliberately carries no order total
 * and no session id — the provider's search API doesn't return either.
 */
export class ProviderOrder {
  constructor(
    public readonly reference: string,
    public readonly placedAt: string | null,
    public readonly isTest: boolean,
    public readonly isCharged: boolean,
    public readonly rawStatus: string | null,
    public readonly discountCents: number,
  ) {}
}
