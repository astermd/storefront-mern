import { Command, CommandRunner, Option } from 'nest-commander';
import { ReverseReconciliation } from '../reconciliation/reverse-reconciliation';
import { FailureDigest } from '../support/failure-digest';

interface ReconcileOrdersOptions {
  hours?: string;
}

/**
 * Ported from storefront-lamp/core/Console/ReconcileOrdersCommand.php. `provider:reconcile` — one
 * run of `[21.9a]`'s reverse sweep, from a terminal.
 *
 * The counterpart to `emr:reconcile`, not a second spelling of it: that one starts from a local
 * order and asks whether the EMR heard about it; this one starts from the provider and asks whether
 * this storefront ever heard about the charge.
 *
 * **There is no `--apply`, and its absence is the design.** An unmatched provider order cannot be
 * turned into a local order row — the search projection carries no session, no lines, no buyer and
 * no order total — so the only thing `--apply` could do is fabricate a record of a charge, which
 * `[20.8]` exists to forbid. The recovery path is a person reading these references in the
 * provider's own dashboard.
 *
 * **The exit code answers "did this job measure its window", not "is everything reconciled".** Exit
 * 0 means this run compared every order in its window against a local row — printed for a clean
 * window and a window full of orphans alike. Exit 1 covers every shape of "the number above is a
 * floor, not a total": the provider wasn't answered, a local row couldn't be read, the window was
 * truncated, or the requested window itself was unusable.
 */
@Command({ name: 'provider:reconcile', description: 'Report orders the payment provider took that are not recorded locally' })
export class ReconcileOrdersCommand extends CommandRunner {
  constructor(private readonly reconciliation: ReverseReconciliation) {
    super();
  }

  @Option({ flags: '--hours <hours>', description: 'How far back to sweep, overriding the configured window (use a shorter one when a run reports truncation)' })
  parseHours(value: string): string {
    return value;
  }

  async run(_params: string[], options: ReconcileOrdersOptions): Promise<void> {
    const hours = options.hours;

    if (hours !== undefined && !/^\d+(\.\d+)?$/.test(hours)) {
      // Refused rather than ignored — falling back to the configured window would sweep a span the
      // operator did not ask for and report its figure as though they had.
      console.error('--hours must be a number of hours; nothing was swept.');
      process.exitCode = 1;
      return;
    }

    const lookback = hours !== undefined ? Math.round(Number(hours) * 3600) : undefined;

    let report;
    try {
      report = await this.reconciliation.run(new Date(), lookback);
    } catch (error) {
      console.error(`Reverse reconciliation failed: ${FailureDigest.describe(error)}`);

      if (error instanceof Error && error.message.startsWith('OrderSearch:')) {
        // The one outcome `ReverseReconciliation.run()` declares it throws — our own sentence about
        // our own settings, so there is no foreign text in it.
        console.error("The sweep window is unusable: the lookback (--hours, or the configured default) must outlast the sweep's grace period.");
      }

      process.exitCode = 1;
      return;
    }

    if (!report.supported) {
      console.log('The configured payment provider does not support an order search; there is nothing to sweep.');
      return;
    }

    if (report.searchFailed) {
      console.error(`The provider could not be asked what orders it holds (${report.failureReason}).`);
      console.error('This run measured nothing; it is not a report that nothing was lost.');
      process.exitCode = 1;
      return;
    }

    console.log(`Orders placed at the provider but not recorded locally: ${report.lostCharges}`);
    console.log(`  examined this run: ${report.examined} of ${report.reportedTotal}, matched: ${report.matched}`);
    console.log(`  unmatched but never charged: ${report.unmatchedUncharged}`);
    console.log(`  unmatched sandbox orders: ${report.unmatchedTest}`);

    const blind: Array<[string, string]> = [];

    if (report.unreadable > 0) {
      console.error(`  local rows that could not be checked: ${report.unreadable}`);
      blind.push([
        `${report.unreadable} of the ${report.examined} orders read from the provider could not be checked against a local row.`,
        'Check the database this job reads; the `reconcile.local_read_failed` log lines name each order.',
      ]);
    }

    if (report.truncated) {
      // Which half goes unread is not arbitrary: the provider answers newest first on every
      // recorded window, so the limit drops the oldest orders — the ones most likely to have
      // genuinely failed to record, and the ones that age out of the lookback first.
      blind.push([
        `The window held ${report.reportedTotal} orders and this run read ${report.examined}. On every recorded window the provider answers newest first, so the unread orders are the oldest in the window — the ones most likely to be genuinely lost, and the ones that age out of the lookback before another run at these settings reaches them.`,
        'Shorten the window with --hours AND run that often, so consecutive runs still meet end to end.',
      ]);
    }

    if (report.lostChargeReferences.length > 0) {
      console.log('');
      console.log('These provider orders have no local row. Each one is a charge nothing here knows about:');
      for (const reference of report.lostChargeReferences) console.log(`  ${reference}`);
    }

    if (blind.length === 0) {
      return;
    }

    // Last, so it is the last thing in the cron mail, and non-zero, so a scheduler can tell this
    // run from one that read its whole window.
    console.log('');
    for (const [what, remedy] of blind) {
      console.error(what);
      console.log(remedy);
    }
    console.error('The count above is a floor and not a total: this run did not measure its whole window.');

    process.exitCode = 1;
  }
}
