import { ProviderOrder } from './provider-order';

/**
 * Ported from storefront-lamp/core/Payment/OrderSearchResult.php. `ok` is the only field a caller
 * may draw conclusions from — empty-because-nothing-found and empty-because-failed must never be
 * conflated (the whole point of the reverse-reconciliation sweep).
 */
export class OrderSearchResult {
  static readonly UNSUPPORTED = 'unsupported';

  private constructor(
    public readonly ok: boolean,
    public readonly orders: ProviderOrder[],
    public readonly reportedTotal: number | null,
    public readonly failureReason: string | null,
  ) {}

  static of(orders: ProviderOrder[], reportedTotal: number | null = null): OrderSearchResult {
    return new OrderSearchResult(true, orders, reportedTotal, null);
  }

  static failed(reason: string): OrderSearchResult {
    return new OrderSearchResult(false, [], null, reason);
  }

  static unsupported(): OrderSearchResult {
    return OrderSearchResult.failed(OrderSearchResult.UNSUPPORTED);
  }

  truncated(): boolean {
    return this.reportedTotal !== null && this.reportedTotal > this.orders.length;
  }
}
