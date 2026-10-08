import { Command, CommandRunner, Option } from 'nest-commander';
import { DeclineBreakdown } from '../observability/decline-breakdown';
import { Measured } from '../observability/measured';
import { OperationalCounts } from '../observability/operational-counts';
import { OrderRepository } from '../repository/order-repository';
import { ReverseReconciliation } from '../reconciliation/reverse-reconciliation';
import { FailureDigest } from '../support/failure-digest';

interface OpsStatusOptions {
  provider?: boolean;
  json?: boolean;
}

/** Matches `ForwardReconciliation`'s own grace window, so "backlog" means the same thing in both. */
const GRACE_SECONDS = 900;
/** Matches `ForwardReconciliation`'s own repeat-failure window (`[21.8]` (c)). */
const REPEAT_FAILURE_AFTER_SECONDS = 86_400;

/**
 * Ported from storefront-lamp/core/Console/StatusCommand.php. `ops:status` — `[20.12]`'s five
 * monitored counts in one place.
 *
 * Each of them represents money or clinical risk, and spread across separate commands they are five
 * things an operator has to remember to run; together they are a page somebody can look at.
 *
 * **This command reads. It changes nothing.** There is no `--apply` and there never will be: every
 * figure it prints has its own command to act on.
 *
 * **The provider half is opt-in (`--provider`) because it is the only figure that needs an outbound
 * call.** Without the flag it reports "not checked", which is not zero — the distinction
 * `Measured` exists for. A status page that once printed "0 lost charges" from a run whose local
 * read had failed outright is the shape being refused here.
 *
 * **Exit codes.** 0 means every figure asked for was measured completely. 1 means at least one was
 * not — a read that failed, or a provider window truncated so its count is a floor rather than a
 * total. A figure nobody asked for is neither, and does not fail the run.
 */
@Command({ name: 'ops:status', description: 'Report the monitored counts that represent money or clinical risk' })
export class OpsStatusCommand extends CommandRunner {
  constructor(
    private readonly orders: OrderRepository,
    private readonly counts: OperationalCounts,
    private readonly reconciliation: ReverseReconciliation,
  ) {
    super();
  }

  @Option({ flags: '--provider', description: 'Also ask the payment provider what orders it holds. Makes an outbound call; without it that figure reads "not checked"' })
  parseProvider(): boolean {
    return true;
  }

  @Option({ flags: '--json', description: 'Emit one JSON document instead of the operator listing' })
  parseJson(): boolean {
    return true;
  }

  async run(_params: string[], options: OpsStatusOptions): Promise<void> {
    // Computed once, before anything is read, so every figure in this run is measured against the
    // same instant.
    const now = Math.floor(Date.now() / 1000);
    const graceCutoff = new Date((now - GRACE_SECONDS) * 1000).toISOString();
    const escalationCutoff = new Date((now - REPEAT_FAILURE_AFTER_SECONDS) * 1000).toISOString();

    const figures: Record<string, Measured> = {
      orders_placed_at_provider_not_recorded_locally: options.provider === true ? await this.providerLostCharges() : Measured.notChecked(),
      orders_recorded_locally_never_synced: await this.count(() => this.orders.countUnsynced()),
      reconciliation_backlog: await this.count(() => this.orders.countUnsyncedPlacedBefore(graceCutoff)),
      repeat_failures: await this.count(() => this.orders.countUnsyncedPlacedBefore(escalationCutoff)),
      unreconcilable: await this.count(() => this.orders.countUnsyncedWithoutSession()),
      checkouts_without_emr_session: await this.counts.checkoutsWithoutEmrSession(),
      checkouts_reached: await this.counts.checkoutsReached(),
    };

    const declines = await this.counts.declines();

    let complete = declines.available();
    for (const figure of Object.values(figures)) {
      // A figure nobody asked for is not a failed one: the provider half is opt-in, and a run that
      // did not opt in is a complete run.
      complete = complete && (figure.complete() || figure.state === Measured.NOT_CHECKED);
    }

    if (options.json === true) {
      const document: Record<string, unknown> = {};
      for (const [key, figure] of Object.entries(figures)) document[key] = figure.toArray();
      document.declines = declines.toArray();
      document.complete = complete;
      console.log(JSON.stringify(document, null, 2));
    } else {
      this.render(figures, declines);
    }

    if (!complete) process.exitCode = 1;
  }

  /**
   * The reverse sweep's `[20.12]` count, with every shape of blindness the report distinguishes
   * carried through rather than flattened. An unsupported adapter is a deployment fact, not an
   * outage.
   */
  private async providerLostCharges(): Promise<Measured> {
    let report;
    try {
      report = await this.reconciliation.run();
    } catch (error) {
      return Measured.unavailable(FailureDigest.describe(error));
    }

    if (!report.supported) return Measured.notChecked();
    if (report.searchFailed) return Measured.unavailable(report.failureReason ?? 'search_failed');
    if (report.truncated || report.unreadable > 0) return Measured.floor(report.lostCharges);
    return Measured.of(report.lostCharges);
  }

  private async count(read: () => Promise<number>): Promise<Measured> {
    try {
      return Measured.of(await read());
    } catch (error) {
      return Measured.unavailable(error instanceof Error ? error.constructor.name : 'UnknownError');
    }
  }

  private render(figures: Record<string, Measured>, declines: DeclineBreakdown): void {
    console.log(`Orders placed at the provider but not recorded locally: ${figures.orders_placed_at_provider_not_recorded_locally.render()}`);
    console.log('  (--provider asks the provider; it makes an outbound call)');
    console.log('');

    console.log(`Orders recorded locally but never synced to the EMR: ${figures.orders_recorded_locally_never_synced.render()}`);
    console.log(`  reconciliation backlog: ${figures.reconciliation_backlog.render()}`);
    console.log(`  repeatedly failing: ${figures.repeat_failures.render()}`);
    console.log(`  no session, so no retry can ever drain them: ${figures.unreconcilable.render()}`);
    console.log('');

    console.log(`Journeys reaching payment without an EMR session: ${figures.checkouts_without_emr_session.render()} of ${figures.checkouts_reached.render()} checkouts`);
    console.log('');

    this.renderDeclines(declines);
  }

  private renderDeclines(declines: DeclineBreakdown): void {
    if (!declines.available()) {
      console.error(`Declines by reason: unavailable (${declines.failure ?? 'unknown'})`);
      console.error('This is not a report that nothing was declined.');
      return;
    }

    const rate = declines.rate();
    console.log(`Declines: ${declines.total} of ${declines.attempts} charge attempts${rate === null ? '' : ` (${rate}%)`}`);

    for (const [reason, count] of Object.entries(declines.byReason ?? {})) {
      console.log(`  ${count}  ${reason}`);
    }
  }
}
