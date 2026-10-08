import { Injectable, Optional } from '@nestjs/common';
import { RateLimitRepository } from '../repository/rate-limit-repository';
import { ConfigService } from './config';
import { OperatorLog } from './operator-log';

/**
 * Ported from storefront-lamp/core/Support/DatabaseRateLimiter.php. A fixed-window counter per
 * `(bucket, identity)`, kept in the database.
 *
 * **State plainly what this stops and what it does not.** The identity is the client address, so it
 * throttles one caller coming from one address: a stuck retry loop, a double-click storm. It is a
 * flood guard, not a fraud control.
 *
 * **It fails open.** Any database error allows the call and is logged once (`[20.1]`): an outage
 * must not become a storefront that cannot take money. This is the limiter's rule alone — the
 * checkout submit path itself refuses when it cannot *record* an order, since a charge nobody can
 * reconcile is worse than a refused checkout.
 */
@Injectable()
export class DatabaseRateLimiter {
  private readonly clock: () => number;
  private reportedUnavailable = false;
  private readonly reportedUnconfigured = new Set<string>();

  constructor(
    private readonly limits: RateLimitRepository,
    private readonly config: ConfigService,
    private readonly log: OperatorLog,
    @Optional() clock?: () => number,
  ) {
    this.clock = clock ?? (() => Math.floor(Date.now() / 1000));
  }

  /**
   * Whether this call is within the bucket's allowance, counting it if the counter could be read at
   * all. A refusal deliberately does not extend the window. A bucket with no configured policy is
   * allowed and reported once.
   */
  async allow(bucket: string, identity: string): Promise<boolean> {
    const policy = this.config.payment.rateLimits[bucket];

    if (policy === undefined) {
      if (!this.reportedUnconfigured.has(bucket)) {
        this.reportedUnconfigured.add(bucket);
        this.log.warning('rate_limit_bucket_unconfigured', { bucket });
      }
      return true;
    }

    const window = Math.max(1, policy.windowSeconds);
    const limit = Math.max(0, policy.limit);

    let hits: number;
    try {
      hits = await this.limits.hit(bucket, identity, window, this.clock());
    } catch (error) {
      if (!this.reportedUnavailable) {
        this.reportedUnavailable = true;
        this.log.warning('rate_limit_unavailable', { bucket, reason: error instanceof Error ? error.message : String(error) });
      }
      return true;
    }

    return hits <= limit;
  }
}
