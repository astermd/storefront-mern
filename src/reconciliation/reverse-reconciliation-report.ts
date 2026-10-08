/**
 * Ported from storefront-lamp/core/Reconciliation/ReverseReconciliationReport.php. What one reverse
 * sweep saw at the provider, and how much of it this storefront has no record of.
 *
 * **`lostCharges` is `[20.12]`'s monitored count** — "orders placed at the provider but not
 * recorded locally" — deliberately the narrowest of the four unmatched figures rather than their
 * sum:
 *
 * - **`unmatchedUncharged`** — the provider holds an order container whose card was never charged.
 *   No money moved, so nothing was lost.
 * - **`unmatchedTest`** — a sandbox order: a real record at the provider and never a real charge.
 *   Counted rather than dropped, since in a sandbox deployment it is the only proof the sweep is
 *   still running.
 * - **`unreadable`** — the local row could not be read at all. A database error is not evidence
 *   that an order is missing, and treating it as one would report every order the provider holds as
 *   a lost charge the moment the database went away.
 *
 * **`searchFailed` exists so zero can be trusted.** An empty window and an unanswered call both
 * produce zero orders, and only one of them means nothing was lost.
 *
 * **`truncated` is the same guarantee for the other end.** A sweep whose window held more orders
 * than its limit examined a prefix and said nothing about the rest — `lostCharges` is then a floor
 * rather than a total, same as when `unreadable > 0`.
 */
export class ReverseReconciliationReport {
  constructor(
    /** Whether the configured adapter can be asked for its orders at all. */
    public readonly supported: boolean = true,
    /** Whether the provider was asked and did not answer. */
    public readonly searchFailed: boolean = false,
    /** An operator-facing code, never provider free text. */
    public readonly failureReason: string | null = null,
    /** Provider orders this run read and matched against local rows. */
    public readonly examined: number = 0,
    /** How many the provider says the window held. */
    public readonly reportedTotal: number = 0,
    /** Whether the limit cut the window short. */
    public readonly truncated: boolean = false,
    /** Provider orders that do have a local row. */
    public readonly matched: number = 0,
    /** Charged, live, and recorded nowhere locally (`[20.12]`). */
    public readonly lostCharges: number = 0,
    /** Charged sandbox orders with no local row. */
    public readonly unmatchedTest: number = 0,
    /** Unmatched orders whose card was never charged. */
    public readonly unmatchedUncharged: number = 0,
    /** Unmatched-or-not: the local row could not be read. */
    public readonly unreadable: number = 0,
    /** The provider references an operator has to look up by hand. */
    public readonly lostChargeReferences: string[] = [],
  ) {}

  /** The report as the operator log and the console both render it — one shape for both destinations. */
  toArray(): Record<string, number | boolean | string | null> {
    return {
      supported: this.supported,
      search_failed: this.searchFailed,
      failure_reason: this.failureReason,
      examined: this.examined,
      reported_total: this.reportedTotal,
      truncated: this.truncated,
      matched: this.matched,
      lost_charges: this.lostCharges,
      unmatched_test: this.unmatchedTest,
      unmatched_uncharged: this.unmatchedUncharged,
      unreadable: this.unreadable,
    };
  }
}
