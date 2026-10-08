import { Injectable } from '@nestjs/common';
import { ConfigService } from '../support/config';

/**
 * Ported from storefront-lamp/core/Retention/RetentionPolicy.php. The configured retention
 * periods, read in one place.
 *
 * `[30.5]` makes the periods configuration because the correct one varies by jurisdiction; `[30.6]`
 * makes them enforced by a job because data that is merely supposed to expire does not expire. This
 * class is the seam between the two — `config/retention.ts` states the policy, `db:prune` carries it
 * out, and neither reads the other's shape.
 *
 * Every period is expressed as a **cutoff timestamp** rather than a day count, because that is what
 * a caller actually needs and because deriving it once here means the local database and the log
 * directory cannot end up comparing against three slightly different "now"s in one run.
 *
 * A period of zero or less disables that expiry rather than deleting everything.
 */
@Injectable()
export class RetentionPolicy {
  /**
   * How recent a journey has to be before no configured period may reach it.
   *
   * `[30.5]` lets a deployment choose its own retention, and a short one is a legitimate choice —
   * but a period is a statement about *age*, and there is a window in which age is not the only
   * thing that matters. Both reconciliation sweeps work backwards from now over recent activity:
   * `ReverseReconciliation` asks the provider what it charged in the last two days and looks for the
   * local rows, and `ForwardReconciliation` escalates an order still unsynced a day after placement.
   * A session deleted inside that window is a charge whose journey no longer exists to be matched to
   * — and unlike a row that expires a week early, nothing can recover it.
   *
   * Two days, the widest of those windows. It is a floor and not a ceiling: a period longer than
   * this is honoured as written, and only one shorter is held back.
   */
  static readonly RECONCILIATION_FLOOR_SECONDS = 172_800;

  constructor(
    private readonly sessionDays: number,
    private readonly eventDays: number,
    private readonly logDays: number,
  ) {}

  static fromConfig(config: ConfigService): RetentionPolicy {
    return new RetentionPolicy(config.retention.operational.sessionDays, config.retention.operational.eventDays, config.retention.operational.logDays);
  }

  getSessionDays(): number {
    return this.sessionDays;
  }

  getEventDays(): number {
    return this.eventDays;
  }

  getLogDays(): number {
    return this.logDays;
  }

  /**
   * The cutoff for analytics session rows, or null when session expiry is disabled. Compared
   * against `sessions.updatedAt` rather than `createdAt`: a journey's age for retention purposes is
   * when it last moved. Held back by `RECONCILIATION_FLOOR_SECONDS`, so a period shorter than the
   * reconciliation window cannot delete the journey behind a charge that is still being matched.
   */
  sessionCutoff(now?: number): string | null {
    return this.floored(RetentionPolicy.cutoff(this.sessionDays, now), now);
  }

  /**
   * The cutoff for audit-trail rows, or null when event expiry is disabled. Held back by the same
   * floor as the sessions: the trail is what an investigation into a mismatched order reads once a
   * sweep has found one.
   */
  eventCutoff(now?: number): string | null {
    return this.floored(RetentionPolicy.cutoff(this.eventDays, now), now);
  }

  /**
   * The cutoff for files under `storage/logs/`, or null when log expiry is disabled. Deliberately
   * not held back by the reconciliation floor — neither sweep reads a log file.
   */
  logCutoff(now?: number): string | null {
    return RetentionPolicy.cutoff(this.logDays, now);
  }

  private static cutoff(days: number, now?: number): string | null {
    if (days <= 0) return null;
    return new Date(((now ?? Math.floor(Date.now() / 1000)) - days * 86_400) * 1000).toISOString();
  }

  /**
   * The cutoff, or the reconciliation floor when the cutoff is more recent than it. A string
   * comparison rather than arithmetic on the two timestamps: `toISOString()` is fixed-width UTC, so
   * lexicographic order is chronological order.
   */
  private floored(cutoff: string | null, now?: number): string | null {
    if (cutoff === null) return null;

    const floor = new Date(((now ?? Math.floor(Date.now() / 1000)) - RetentionPolicy.RECONCILIATION_FLOOR_SECONDS) * 1000).toISOString();

    return cutoff > floor ? floor : cutoff;
  }
}
