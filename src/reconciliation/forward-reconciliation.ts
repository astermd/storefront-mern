import { Inject, Injectable } from '@nestjs/common';
import { CheckoutEventReporter } from '../checkout/checkout-event-reporter';
import { CHECKOUT_EVENT_REPORTER } from '../core/tokens';
import { OrderRepository } from '../repository/order-repository';
import { FailureDigest } from '../support/failure-digest';
import { OperatorLog } from '../support/operator-log';
import { ReconciliationReport } from './reconciliation-report';

const PLACED = 'placed';

/**
 * Ported from storefront-lamp/core/Reconciliation/ForwardReconciliation.php. `[21.8]`'s forward
 * sweep: the orders this storefront recorded and the EMR was never told about, told about.
 *
 * **The predicate is `treatmentReference IS NULL`**, and it was settled before anything could run
 * it: the checkout event reporter stamps that column only after a sync the EMR accepted, so null
 * means "never told" and nothing else. Load-bearing: **the EMR cannot be asked what it already
 * has** — its treatment listing ignores every filter offered to it — so the local null column is
 * the only usable signal there is.
 *
 * **The grace window is not tidiness.** An order placed seconds ago has not failed to sync: the
 * request that placed it reports it in the same breath. Sweeping inside that window would race a
 * call already in flight.
 *
 * **Repeat failure is measured in age, because there is no attempt counter.** Every order with a
 * session is synced on the money path when it is placed and again when the journey completes, so a
 * row still null a day later has outlived both of those and every sweep since. An order with no
 * session has never been attempted at all — reported separately, since calling it a repeat failure
 * would send an operator looking for an outage that is not there.
 *
 * **Nothing here decides whether a sync worked; it reads the row.** The reporting port returns
 * nothing by contract (`[20.1]`), so the sweep asks the durable signal instead — the same column it
 * selected on — which also means it cannot be fooled by a reporter that claims success and writes
 * nothing.
 *
 * **This job must never crash the storefront** (`[20.1]`). Every EMR call is wrapped even though
 * the port forbids throwing, and a session that fails is logged and followed by the next one.
 */
@Injectable()
export class ForwardReconciliation {
  /** How long after placement an order is left to the checkout path before a sweep touches it. */
  private static readonly GRACE_SECONDS = 900;
  /** How long a row may stay null before it stops being a retry and becomes something to look at. */
  private static readonly REPEAT_FAILURE_AFTER_SECONDS = 86_400;
  /** The most orders one run will read; the monitored counts are not bounded by it. */
  private static readonly BATCH_SIZE = 200;

  constructor(
    private readonly orders: OrderRepository,
    @Inject(CHECKOUT_EVENT_REPORTER) private readonly events: CheckoutEventReporter,
    private readonly log: OperatorLog,
  ) {}

  /** One sweep. `apply` false is the safe default every outbound command in this theme has. */
  async run(apply = false): Promise<ReconciliationReport> {
    // Both cutoffs are computed once, before anything is read, so every count and every row in this
    // run is measured against the same instant.
    const now = Math.floor(Date.now() / 1000);
    const graceCutoff = new Date((now - ForwardReconciliation.GRACE_SECONDS) * 1000).toISOString();
    const escalationCutoff = new Date((now - ForwardReconciliation.REPEAT_FAILURE_AFTER_SECONDS) * 1000).toISOString();

    const rows = await this.orders.findUnsyncedPlacedBefore(graceCutoff, ForwardReconciliation.BATCH_SIZE);

    const batches = new Map<string, string[]>();
    const aged: Array<{ reference: string; placedAt: string }> = [];
    let skipped = 0;

    for (const row of rows) {
      const reason = ForwardReconciliation.refusalReasonFor(row);

      if (reason !== null) {
        skipped += 1;
        this.log.warning('reconcile.order_unreconcilable', { reference: row.providerReference, reason, placed_at: row.placedAt });
        continue;
      }

      if (row.placedAt < escalationCutoff) {
        aged.push({ reference: row.providerReference, placedAt: row.placedAt });
      }

      // Grouped by session because the EMR accumulates a session's orders into one treatment
      // record — two calls for two orders and one call for both leave the same single record.
      const sessionUuid = row.sessionUuid as string; // refusalReasonFor already excluded null sessions.
      const references = batches.get(sessionUuid) ?? [];
      references.push(row.providerReference);
      batches.set(sessionUuid, references);
    }

    let synced = 0;
    let failed = 0;
    const stillUnsynced: string[] = [];

    if (apply) {
      for (const [sessionUuid, references] of batches) {
        await this.syncBatch(sessionUuid, references);

        for (const reference of references) {
          if (await this.wasStamped(reference)) {
            synced += 1;
            continue;
          }

          failed += 1;
          stillUnsynced.push(reference);
          this.log.warning('reconcile.order_sync_failed', { reference });
        }
      }
    }

    // `[21.8]` (c), reported *after* the attempt rather than before it: an order that has been
    // stuck for a day but went through on this run is not something an operator needs to look at.
    // On a dry run nothing was attempted, so every aged order is still stuck by definition.
    const repeatFailureReferences: string[] = [];

    for (const candidate of aged) {
      if (apply && !stillUnsynced.includes(candidate.reference)) {
        continue;
      }

      repeatFailureReferences.push(candidate.reference);
      this.log.warning('reconcile.repeat_failure', candidate);
    }

    const report = new ReconciliationReport(
      await this.orders.countUnsynced(),
      await this.orders.countUnsyncedPlacedBefore(graceCutoff),
      await this.orders.countUnsyncedPlacedBefore(escalationCutoff),
      await this.orders.countUnsyncedWithoutSession(),
      rows.length,
      synced,
      failed,
      skipped,
      repeatFailureReferences,
      !apply,
    );

    // `[20.12]`: one line per run carrying every monitored count, whether or not there was anything
    // to do. A log that only speaks up when something is wrong cannot be distinguished from one
    // that has stopped running.
    this.log.info('reconcile.forward_sweep', report.toArray());

    return report;
  }

  /** Why this row will not be sent, or null when it will be. */
  private static refusalReasonFor(row: { sessionUuid: string | null; status: string }): string | null {
    if (row.sessionUuid === null) {
      // Not a failure and not backlog: the EMR keys a treatment record on the session uuid, so
      // there is nothing to file this order under, and `[20.8]` forbids inventing an identifier to
      // close the gap. Retrying it on every sweep forever would report a queue that can never drain.
      return 'no_session';
    }

    return row.status === PLACED ? null : 'not_placed';
  }

  /**
   * One session's batch, with the whole containment contract around it. The port is documented
   * never to throw and this catches anyway: `[20.1]` is a property this job has to hold on its own.
   * The provider's message is never logged — it is built from the EMR's own text and this payload
   * carries order references (`[20.6]`).
   */
  private async syncBatch(sessionUuid: string, references: string[]): Promise<void> {
    try {
      await this.events.treatmentsSynced(sessionUuid, references);
    } catch (error) {
      this.log.warning('reconcile.batch_failed', { session: sessionUuid, orders: references.length, exception: FailureDigest.describe(error) });
    }
  }

  /**
   * Did the EMR actually learn about this order? Read back off the row rather than taken from the
   * call, because the call returns nothing to take — the column is the durable signal the whole
   * predicate rests on, so asking it is the only answer that stays true after this process exits.
   */
  private async wasStamped(reference: string): Promise<boolean> {
    try {
      const order = await this.orders.findByReference(reference);
      return (order?.treatmentReference ?? null) !== null;
    } catch (error) {
      this.log.warning('reconcile.read_back_failed', { reference, exception: FailureDigest.describe(error) });
      // An order whose row could not be re-read is not an order known to have synced. Counting it
      // as one would retire it from the figure an operator watches on the strength of a database error.
      return false;
    }
  }
}
