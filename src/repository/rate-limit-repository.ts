import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { DATABASE_CONNECTION } from '../core/tokens';

/**
 * Ported from storefront-lamp/core/Repository/RateLimitRepository.php. The `rate_limits` table: a
 * fixed-window counter per `(bucket, identity)`.
 *
 * The window is fixed rather than sliding — a sliding window needs a durable list of individual hit
 * timestamps, which this storefront has no reason to keep. Two requests racing on the same key can
 * both read the same count, undercounting by one; accepted, since this is a flood guard and not a
 * billing meter.
 */
@Injectable()
export class RateLimitRepository {
  constructor(@Inject(DATABASE_CONNECTION) private readonly prisma: PrismaClient) {}

  /**
   * Counts one hit against `(bucket, identity)` and returns the running total for the window it
   * falls in. Three steps because no portable single statement expresses "increment, unless the
   * window has moved on, in which case start again":
   *
   * 1. A conditional insert, which wins when this key has never been seen.
   * 2. A conditional update that rolls the window over — fires when the window has expired *or*
   *    when `now` is behind the stored start (a clock moving backwards must not lock an address out
   *    until real time catches up with a window that never happened).
   * 3. Otherwise, a plain increment inside the current window.
   */
  async hit(bucket: string, identity: string, windowSeconds: number, now: number): Promise<number> {
    try {
      await this.prisma.rateLimit.create({ data: { bucket, identity, hits: 1, windowStart: now } });
      return 1;
    } catch {
      // Falls through to the rollover/increment path below — some driver already holds this row.
    }

    const rolled = await this.prisma.rateLimit.updateMany({
      where: { bucket, identity, OR: [{ windowStart: { lte: now - windowSeconds } }, { windowStart: { gt: now } }] },
      data: { hits: 1, windowStart: now },
    });
    if (rolled.count > 0) return 1;

    await this.prisma.rateLimit.updateMany({ where: { bucket, identity }, data: { hits: { increment: 1 } } });

    const row = await this.prisma.rateLimit.findUnique({ where: { bucket_identity: { bucket, identity } } });
    return row?.hits ?? 1;
  }

  /**
   * Ported for `db:prune` (Phase 10, deferred from Phase 7). `windowStart` is a raw unix-seconds
   * integer, unlike every other cutoff in this port, since the guard's own arithmetic is integer
   * seconds throughout.
   */
  async expire(before: number): Promise<number> {
    const result = await this.prisma.rateLimit.deleteMany({ where: { windowStart: { lt: before } } });
    return result.count;
  }

  async countExpirable(before: number): Promise<number> {
    return this.prisma.rateLimit.count({ where: { windowStart: { lt: before } } });
  }
}
