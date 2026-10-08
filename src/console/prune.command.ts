import { Command, CommandRunner, Option } from 'nest-commander';
import { CheckoutAttemptRepository } from '../repository/checkout-attempt-repository';
import { RateLimitRepository } from '../repository/rate-limit-repository';
import { RetentionPolicy } from '../retention/retention-policy';
import { RetentionSweep } from '../retention/retention-sweep';
import { LogSweep } from '../retention/log-sweep';
import { FailureDigest } from '../support/failure-digest';

const DEFAULT_ATTEMPT_DAYS = 30;
const DEFAULT_RATE_LIMIT_HOURS = 24;

interface PruneOptions {
  apply?: boolean;
  dryRun?: boolean;
  attemptDays?: string;
  rateLimitHours?: string;
}

/**
 * Ported from storefront-lamp/core/Console/PruneCommand.php. `db:prune` — the sweep that takes aged
 * rows out of the tables nothing has ever deleted from, and the aged files out of `storage/logs/`.
 *
 * `checkout_attempts` and `rate_limits` are both written on the checkout path and neither is ever
 * cleaned by anything else. `sessions`, `events` and the log directory are `[30.6]`'s three named
 * operational categories, governed by `config/retention.ts` through `RetentionPolicy` (`[30.5]`) —
 * not by this command's own options, since how long a person's journey is kept is a policy decision
 * that belongs in configuration.
 *
 * **The interesting half of this command is what it refuses to touch.** A `sent` checkout attempt is
 * never deleted at any age — the provider was contacted and never answered, and no amount of time
 * settles whether money moved. A session an `orders` row references is never taken at any age either,
 * and no configured period may reach inside the window either reconciliation sweep still reads
 * (`RetentionPolicy.RECONCILIATION_FLOOR_SECONDS`). Both are counted and reported instead.
 *
 * **Dry run by default**, matching `theme:sync`/`emr:reconcile`: `--apply` acts, and `--dry-run`
 * overrides `--apply` so a scheduled entry can be made harmless by adding a flag.
 *
 * Exit code 0 means every sweep this run attempted completed. Exit code 1 means one did not — a
 * retention option below one, a repository call that threw, or a log directory that exists and
 * cannot be listed. **The sweeps are not one transaction**: under `--apply`, a failure partway
 * through means earlier deletes already happened, so the failure branch names what was done before it
 * stopped.
 */
@Command({ name: 'db:prune', description: 'Report (and, with --apply, delete) operational data past its retention period' })
export class PruneCommand extends CommandRunner {
  constructor(
    private readonly attempts: CheckoutAttemptRepository,
    private readonly limits: RateLimitRepository,
    private readonly retention: RetentionSweep,
    private readonly logs: LogSweep,
    private readonly policy: RetentionPolicy,
  ) {
    super();
  }

  @Option({ flags: '--apply', description: 'Actually delete the aged rows (default is a dry run that only reports them)' })
  parseApply(): boolean {
    return true;
  }

  @Option({ flags: '--dry-run', description: 'Report only, overriding --apply' })
  parseDryRun(): boolean {
    return true;
  }

  @Option({ flags: '--attempt-days <days>', description: 'Keep checkout attempts for this many days' })
  parseAttemptDays(value: string): string {
    return value;
  }

  @Option({ flags: '--rate-limit-hours <hours>', description: 'Keep rate-limit counters for this many hours' })
  parseRateLimitHours(value: string): string {
    return value;
  }

  async run(_params: string[], options: PruneOptions): Promise<void> {
    const apply = options.apply === true && options.dryRun !== true;

    // Both floors are one whole unit, already orders of magnitude past the thing each retention has
    // to clear. A typo in a crontab must not be able to spell "delete everything".
    const days = PruneCommand.positiveInteger(options.attemptDays ?? String(DEFAULT_ATTEMPT_DAYS));
    const hours = PruneCommand.positiveInteger(options.rateLimitHours ?? String(DEFAULT_RATE_LIMIT_HOURS));

    if (days === null || hours === null) {
      console.error('Retentions must be whole numbers of at least 1; nothing was pruned.');
      process.exitCode = 1;
      return;
    }

    // One instant for the whole run, so no two sweeps measure "old" against slightly different nows.
    const now = Math.floor(Date.now() / 1000);
    const attemptsBefore = new Date((now - days * 86_400) * 1000).toISOString();
    const limitsBefore = now - hours * 3_600;

    let unresolved: number;
    let heldByOrders = 0;
    const done: string[] = [];
    const verb = apply ? 'deleted' : 'would delete';

    try {
      const sweptAttempts = apply ? await this.attempts.expire(attemptsBefore) : await this.attempts.countExpirable(attemptsBefore);
      done.push(`checkout_attempts older than ${days}d — ${verb}: ${sweptAttempts}`);

      unresolved = await this.attempts.countUnresolved(attemptsBefore);

      const sweptLimits = apply ? await this.limits.expire(limitsBefore) : await this.limits.countExpirable(limitsBefore);
      done.push(`rate_limits with windows closed over ${hours}h ago — ${verb}: ${sweptLimits}`);

      const sessionCutoff = this.policy.sessionCutoff(now);
      if (sessionCutoff === null) {
        done.push(`sessions — expiry disabled (retention.operational.session_days is ${this.policy.getSessionDays()})`);
      } else {
        heldByOrders = await this.retention.countSessionsHeldByOrders(sessionCutoff);
        const sweptSessions = apply ? await this.retention.expireSessions(sessionCutoff) : await this.retention.countExpirableSessions(sessionCutoff);
        done.push(`sessions last moved before ${sessionCutoff} — ${verb}: ${sweptSessions}`);
      }

      const eventCutoff = this.policy.eventCutoff(now);
      if (eventCutoff === null) {
        done.push(`events — expiry disabled (retention.operational.event_days is ${this.policy.getEventDays()})`);
      } else {
        const sweptEvents = apply ? await this.retention.expireEvents(eventCutoff) : await this.retention.countExpirableEvents(eventCutoff);
        done.push(`events older than ${eventCutoff} — ${verb}: ${sweptEvents}`);
      }

      const logCutoff = this.policy.logCutoff(now);
      if (logCutoff === null) {
        done.push(`storage/logs — expiry disabled (retention.operational.log_days is ${this.policy.getLogDays()})`);
      } else {
        const sweptLogs = apply ? this.logs.expire(logCutoff) : this.logs.countExpirable(logCutoff);
        done.push(`storage/logs files last written before ${logCutoff} — ${verb}: ${sweptLogs}`);
      }
    } catch (error) {
      // The class and (for a Prisma error) its code, never the message — see FailureDigest.
      console.error(`Prune failed: ${FailureDigest.describe(error)}`);

      // What already happened before it stopped. Only under --apply, since a dry run's completed
      // steps deleted nothing.
      if (apply && done.length > 0) {
        for (const line of done) console.error(line);
        console.error('(this run stopped after that, so re-running it resumes rather than repeats)');
      }

      process.exitCode = 1;
      return;
    }

    for (const line of done) console.log(line);

    if (heldByOrders > 0) {
      console.log('');
      console.log(`Sessions past their period kept because an order references them: ${heldByOrders}`);
    }

    if (unresolved > 0) {
      console.log('');
      console.log(`Unresolved checkout attempts older than ${days}d (kept, and each needs a person): ${unresolved}`);
      console.log('  Look each one up by the `checkout.attempt_unresolved` log line that recorded it.');
    }

    if (!apply) {
      console.log('');
      console.log('(dry run — use --apply to delete)');
    }
  }

  /**
   * A retention option as a whole number of at least one, or null when it is anything else.
   * Deliberately strict rather than a cast: `Number('thirty')` is `NaN`, but a naive `parseInt`
   * would give `0` for something like `'0abc'` — a zero retention here means "everything is old
   * enough", the one answer this command must never arrive at by accident.
   */
  private static positiveInteger(value: string): number | null {
    if (!/^\d+$/.test(value)) return null;
    const parsed = Number(value);
    return parsed >= 1 ? parsed : null;
  }
}
