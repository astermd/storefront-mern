import { Inject, Injectable } from '@nestjs/common';
import { PAYMENT_ADAPTER } from '../core/tokens';
import { OrderRepository } from '../repository/order-repository';
import { OrderSearch } from '../payment/order-search';
import { PaymentAdapter } from '../payment/payment-adapter';
import { ProviderOrder } from '../payment/provider-order';
import { FailureDigest } from '../support/failure-digest';
import { OperatorLog } from '../support/operator-log';
import { ReverseReconciliationReport } from './reverse-reconciliation-report';

/**
 * Ported from storefront-lamp/core/Reconciliation/ReverseReconciliation.php. `[21.9a]`'s reverse
 * sweep: the orders the provider took that this storefront has no record of at all.
 *
 * **This is not the mirror of the forward sweep, and the difference is the whole point.**
 * `ForwardReconciliation` starts from a local row and asks whether the EMR heard about it — there
 * is always something local to work from. Here the card was charged at the provider and the
 * storefront died before the order row was written, so **there is no local record of any kind**.
 * The only way to see one of these is to ask the provider what it took and look for the answers
 * that are missing on this side.
 *
 * **It detects and counts; it does not attribute.** `[21.9b]` names the analytics session
 * identifier as the recovery key, but this deployment's provider search never returns one back
 * (`[21.9b]` is recorded as a gap this provider cannot close, not implemented here), so an orphan is
 * handed to an operator to investigate in the provider's own dashboard.
 *
 * **Nothing here writes, and there is deliberately nothing to apply.** An unmatched provider order
 * cannot be turned into a local order row — the search projection carries no session, no lines, no
 * buyer and no order total — so a row built from it would be a fabricated record of a charge, which
 * is exactly what `[20.8]` forbids.
 *
 * **How the three unmatched shapes are treated:** a null-status container was never charged (not a
 * loss); a sandbox order is counted apart from a lost charge (so a staging sweep isn't a permanent
 * zero); a local row that cannot be read is neither matched nor lost — `unreadable` makes
 * `lostCharges` a floor, never a total.
 *
 * In this Null-payment-only port, `NullPaymentAdapter.capabilities().supportsOrderSearch` is
 * `false`, so `run()` always takes the very first branch — the correct, honest "unsupported"
 * degradation, not a stub.
 */
@Injectable()
export class ReverseReconciliation {
  /** How far back one sweep looks by default — matches `RetentionPolicy.RECONCILIATION_FLOOR_SECONDS` (2 days), so a run missed overnight is covered by the next one. */
  private static readonly DEFAULT_LOOKBACK_SECONDS = 172_800;
  /** How close to now the window stops, so a checkout still in flight is not reported as an order this storefront failed to record. */
  private static readonly GRACE_SECONDS = 900;

  constructor(
    @Inject(PAYMENT_ADAPTER) private readonly adapter: PaymentAdapter,
    private readonly orders: OrderRepository,
    private readonly log: OperatorLog,
  ) {}

  /**
   * One sweep. `lookbackSeconds` overrides the configured window for this run only — what the
   * console offers an operator whose window came back truncated.
   *
   * @throws Error when the requested window does not outlast the grace window; a sweep that cannot
   * see anything must not report that there was nothing to see.
   */
  async run(now: Date = new Date(), lookbackSeconds?: number): Promise<ReverseReconciliationReport> {
    const capabilities = this.adapter.capabilities();

    if (!capabilities.supportsOrderSearch) {
      // Not a failure: a deployment whose provider cannot be asked what orders it holds has no
      // reverse sweep to run. Reported as its own state so it can never be read as "asked, and
      // nothing was lost".
      this.log.info('reconcile.reverse_sweep_unsupported', { provider: capabilities.providerCategory });
      return this.report(new ReverseReconciliationReport(false));
    }

    // 200 mirrors `OrderSearch`'s own default limit (private to that class) — passed explicitly
    // since `lookback()` requires it positionally.
    const result = await this.adapter.searchOrders(
      OrderSearch.lookback(lookbackSeconds ?? ReverseReconciliation.DEFAULT_LOOKBACK_SECONDS, ReverseReconciliation.GRACE_SECONDS, 200, now),
    );

    if (!result.ok) {
      this.log.warning('reconcile.order_search_failed', { reason: result.failureReason });
      return this.report(new ReverseReconciliationReport(true, true, result.failureReason));
    }

    if (result.truncated()) {
      // The window held more than one run can read, so everything past the limit went unexamined.
      this.log.warning('reconcile.reverse_sweep_truncated', { examined: result.orders.length, reported_total: result.reportedTotal });
    }

    let matched = 0;
    let unmatchedTest = 0;
    let unmatchedUncharged = 0;
    let unreadable = 0;
    const lost: string[] = [];

    for (const order of result.orders) {
      const known = await this.isRecordedLocally(order.reference);

      if (known === null) {
        unreadable += 1;
        continue;
      }

      if (known) {
        matched += 1;
        continue;
      }

      // The order the provider holds is on this side nowhere. What kind of nowhere decides whether
      // anyone is told.
      if (!order.isCharged) {
        unmatchedUncharged += 1;
        continue;
      }

      if (order.isTest) {
        unmatchedTest += 1;
        continue;
      }

      lost.push(order.reference);
      this.reportLostCharge(order);
    }

    return this.report(
      new ReverseReconciliationReport(
        true,
        false,
        null,
        result.orders.length,
        result.reportedTotal ?? 0,
        result.truncated(),
        matched,
        lost.length,
        unmatchedTest,
        unmatchedUncharged,
        unreadable,
        lost,
      ),
    );
  }

  /**
   * Is this provider order recorded here? Null when the question could not be asked. A read that
   * threw is not a missing order, and collapsing it to false would turn a database outage into a
   * report that every charge the provider took had been lost. Collapsing it to true is the more
   * dangerous mistake, because its output is an all-clear.
   */
  private async isRecordedLocally(reference: string): Promise<boolean | null> {
    try {
      return (await this.orders.findByReference(reference)) !== null;
    } catch (error) {
      this.log.warning('reconcile.local_read_failed', { reference, exception: FailureDigest.describe(error) });
      return null;
    }
  }

  /**
   * One order the buyer was charged for and this storefront has no record of. At error level
   * because money moved and nothing on this side knows it, and named one per line because the
   * action it calls for is looking each one up by hand. **Identifiers and counts only** — no part
   * of the provider's projection is logged.
   */
  private reportLostCharge(order: ProviderOrder): void {
    this.log.error('reconcile.order_not_recorded', {
      reference: order.reference,
      placed_at: order.placedAt,
      raw_status: order.rawStatus,
      discount_cents: order.discountCents,
    });
  }

  /** `[20.12]`: one line per run carrying the monitored count, whether or not there was anything to report. */
  private report(report: ReverseReconciliationReport): ReverseReconciliationReport {
    this.log.info('reconcile.reverse_sweep', report.toArray());
    return report;
  }
}
