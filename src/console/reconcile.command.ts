import { Command, CommandRunner, Option } from 'nest-commander';
import { ForwardReconciliation } from '../reconciliation/forward-reconciliation';
import { FailureDigest } from '../support/failure-digest';

interface ReconcileOptions {
  apply?: boolean;
  dryRun?: boolean;
}

/**
 * Ported from storefront-lamp/core/Console/ReconcileCommand.php. `emr:reconcile` — one run of
 * `[21.8]`'s forward sweep, from a terminal.
 *
 * **There is no scheduler in this codebase, and this command does not add one.** It is safe to run
 * as often as an operator's own schedule likes: the grace window keeps it off orders the checkout
 * path has not finished with, and the EMR deduplicates a sync per session.
 *
 * **The default is a dry run**, as for every other outbound command in this theme. `--apply` opts in
 * to actually telling the EMR about the backlog; `--dry-run` beats `--apply`, the brake an operator
 * can add to an existing scheduled invocation without editing its flags.
 *
 * **A sync that failed is not a failed run.** Exit code 0 means the backlog was measured — empty,
 * full, or full of orders the EMR refused this run. Exit code 1 means the `orders` table could not
 * be read at all, since a run reporting "nothing outstanding" because the database was unreachable
 * is precisely the silent failure this sweep exists to end.
 */
@Command({ name: 'emr:reconcile', description: 'Report (and, with --apply, sync) orders the EMR was never told about' })
export class ReconcileCommand extends CommandRunner {
  constructor(private readonly reconciliation: ForwardReconciliation) {
    super();
  }

  @Option({ flags: '--apply', description: 'Actually sync the backlog (default is a dry run that only reports it)' })
  parseApply(): boolean {
    return true;
  }

  @Option({ flags: '--dry-run', description: 'Report only, overriding --apply' })
  parseDryRun(): boolean {
    return true;
  }

  async run(_params: string[], options: ReconcileOptions): Promise<void> {
    const apply = options.apply === true && options.dryRun !== true;

    let report;
    try {
      report = await this.reconciliation.run(apply);
    } catch (error) {
      console.error(`Reconciliation failed: ${FailureDigest.describe(error)}`);
      process.exitCode = 1;
      return;
    }

    console.log(`Orders the EMR was never told about: ${report.unsynced}`);
    console.log(`  reconciliation backlog: ${report.backlog}`);
    console.log(`  unreconcilable (no analytics session): ${report.unreconcilable}`);
    console.log(`  examined this run: ${report.examined}, synced: ${report.synced}, failed: ${report.failed}, skipped: ${report.skipped}`);

    if (report.repeatFailureReferences.length > 0) {
      console.log('');
      console.log('Repeat failures — these have not synced since they were placed:');
      for (const reference of report.repeatFailureReferences) console.log(`  ${reference}`);
    }

    if (report.dryRun) {
      console.log('');
      console.log('(dry run — use --apply to sync)');
    }
  }
}
