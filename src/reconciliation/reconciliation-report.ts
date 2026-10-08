/**
 * Ported from storefront-lamp/core/Reconciliation/ReconciliationReport.php. What one forward sweep
 * found and what it managed to do about it.
 *
 * Two kinds of figure live here and they are not interchangeable, which is why they are named apart
 * rather than summed into a single "outstanding":
 *
 * - **`unsynced`, `backlog`, `repeatFailures` and `unreconcilable` describe the whole table.** These
 *   are `[20.12]`'s monitored counts, deliberately not bounded by the batch size — a figure that was
 *   would read as healthy on exactly the deployment whose arrears had overflowed one run.
 * - **`examined`, `synced`, `failed` and `skipped` describe this run.** They are bounded by the
 *   batch size and say what the sweep actually touched.
 *
 * `backlog` and `unreconcilable` are disjoint. An order with no analytics session cannot be synced
 * by any number of retries — the EMR keys a treatment record on the session uuid, and `[20.8]`
 * forbids inventing one — so it is a permanent gap for an operator to resolve by hand, not a queue
 * that will drain. Adding the two together would report a growing backlog that no amount of running
 * this job could ever reduce.
 */
export class ReconciliationReport {
  constructor(
    /** Orders the EMR has never been told about, at all. */
    public readonly unsynced: number = 0,
    /** Of those, the ones past the grace window that a retry could still fix. */
    public readonly backlog: number = 0,
    /** Of those, the ones old enough that every attempt so far has failed (`[21.8]` (c)). */
    public readonly repeatFailures: number = 0,
    /** Never told, and with no session to tell anyone under. */
    public readonly unreconcilable: number = 0,
    /** Rows this run read, bounded by the batch size. */
    public readonly examined: number = 0,
    /** Rows that carried a treatment reference afterwards. */
    public readonly synced: number = 0,
    /** Rows that were attempted and are still null. */
    public readonly failed: number = 0,
    /** Rows this run refused to attempt, with a reason logged for each. */
    public readonly skipped: number = 0,
    /** The aged references this run saw, for the operator line. */
    public readonly repeatFailureReferences: string[] = [],
    /** Whether anything was actually sent. */
    public readonly dryRun: boolean = true,
  ) {}

  /** The report as the operator log and the console both render it — one shape for both destinations. */
  toArray(): Record<string, number | boolean> {
    return {
      unsynced: this.unsynced,
      backlog: this.backlog,
      repeat_failures: this.repeatFailures,
      unreconcilable: this.unreconcilable,
      examined: this.examined,
      synced: this.synced,
      failed: this.failed,
      skipped: this.skipped,
      dry_run: this.dryRun,
    };
  }
}
