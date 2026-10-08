/**
 * Ported from storefront-lamp/core/Payment/OrderSearch.php. A search request against the
 * provider's own order-search API (reconciliation sweeps).
 */
export class OrderSearch {
  private static readonly DEFAULT_LIMIT = 200;
  private static readonly MAX_LIMIT = 1000;

  private constructor(
    public readonly from: Date,
    public readonly to: Date,
    public readonly limit: number,
  ) {}

  /** @throws {Error} if `to` is before `from` — a programming error, not a provider outcome, so `[20.1]` doesn't apply. */
  static between(from: Date, to: Date, limit: number = OrderSearch.DEFAULT_LIMIT): OrderSearch {
    if (to.getTime() < from.getTime()) {
      throw new Error('OrderSearch: `to` must not be before `from`.');
    }
    return new OrderSearch(from, to, Math.min(Math.max(1, limit), OrderSearch.MAX_LIMIT));
  }

  static lookback(seconds: number, graceSeconds: number = 0, limit: number = OrderSearch.DEFAULT_LIMIT, now: Date = new Date()): OrderSearch {
    if (seconds <= graceSeconds) {
      throw new Error('OrderSearch: `seconds` must be greater than `graceSeconds`.');
    }
    const to = new Date(now.getTime() - graceSeconds * 1000);
    const from = new Date(now.getTime() - seconds * 1000);
    return OrderSearch.between(from, to, limit);
  }
}
