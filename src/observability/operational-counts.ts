import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { DATABASE_CONNECTION } from '../core/tokens';
import { CardScrubber } from '../support/card-scrubber';
import { DeclineBreakdown } from './decline-breakdown';
import { Measured } from './measured';

const VISITED = 'checkout.visited';
const DECLINED = 'checkout.order_declined';
const PLACED = 'checkout.order_placed';

/** What a decline with no recorded reason is filed under — a decline whose reason went missing is still a decline. */
const REASON_UNRECORDED = '(no reason recorded)';

/** The most distinct reasons reported before the tail is folded together — a provider composes these sentences and can vary them per decline. */
const MAX_REASONS = 20;

const REASON_OTHER = '(other)';

/**
 * Ported from storefront-lamp/core/Observability/OperationalCounts.php. The two of `[20.12]`'s
 * monitored counts that nothing else counts: journeys reaching payment without an EMR session, and
 * the decline rate by reason.
 *
 * **Both figures here are read from `[18.1]`'s local trail** (the `events` table) rather than from
 * `orders`, because the EMR keeps one checkout record per session and updates it in place — a
 * decline the buyer retried past is gone from it — and no order row exists at all for a charge that
 * never landed. The append-only `events` table is the only place either question can still be
 * answered.
 *
 * Every read is wrapped, and a read that failed answers `Measured.unavailable()` rather than zero.
 * Since `CHECKOUT_EVENT_REPORTER` is Null-bound in this port (see Phase 7/8), nothing currently
 * writes these event names — so these counts honestly read `measured(0)` rather than fabricating a
 * number, exactly the degrade-silently behaviour `[20.1]` asks for.
 */
@Injectable()
export class OperationalCounts {
  private readonly clock: () => number;

  private readonly declineWindowSeconds: number;

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly prisma: PrismaClient,
    /** How far back the decline rate is measured; a rate over all time tells an operator nothing about today. */
    @Optional() declineWindowSeconds?: number,
    @Optional() clock?: () => number,
  ) {
    this.declineWindowSeconds = declineWindowSeconds ?? 2_592_000;
    this.clock = clock ?? (() => Math.floor(Date.now() / 1000));
  }

  /** Checkouts reached with no analytics session to file them under (`[20.12]`). */
  async checkoutsWithoutEmrSession(): Promise<Measured> {
    // The empty string is the absence recorded literally: `events.sessionUuid` is NOT NULL and an
    // invented value would be indistinguishable from a real identifier later (`[20.8]`).
    return this.count(async () => this.prisma.event.count({ where: { name: VISITED, sessionUuid: '' } }));
  }

  /** Every checkout reached, so the figure above can be read as a proportion. */
  async checkoutsReached(): Promise<Measured> {
    return this.count(async () => this.prisma.event.count({ where: { name: VISITED } }));
  }

  async declines(): Promise<DeclineBreakdown> {
    const since = new Date((this.clock() - this.declineWindowSeconds) * 1000).toISOString();

    try {
      const rows = await this.prisma.event.findMany({ where: { name: DECLINED, createdAt: { gte: since } }, select: { payload: true } });

      const byReason: Record<string, number> = {};
      let total = 0;

      for (const row of rows) {
        total++;
        const reason = this.reasonFrom(row.payload ?? '');
        byReason[reason] = (byReason[reason] ?? 0) + 1;
      }

      const placed = await this.count(async () => this.prisma.event.count({ where: { name: PLACED, createdAt: { gte: since } } }));

      if (!placed.available()) {
        return DeclineBreakdown.unavailable(placed.failure ?? 'unknown');
      }

      const sorted = Object.fromEntries(Object.entries(byReason).sort(([, a], [, b]) => b - a));

      return DeclineBreakdown.of(OperationalCounts.capped(sorted), total, total + (placed.value ?? 0));
    } catch (error) {
      return DeclineBreakdown.unavailable(error instanceof Error ? error.constructor.name : 'UnknownError');
    }
  }

  /** The reason a decline was filed under, scrubbed again on the way out — a status surface is a second destination for the same string (`[15.8]`, `[20.14]`). */
  private reasonFrom(payload: string): string {
    let reason = '';
    try {
      const decoded: unknown = JSON.parse(payload);
      if (decoded && typeof decoded === 'object' && typeof (decoded as Record<string, unknown>).reason === 'string') {
        reason = ((decoded as Record<string, unknown>).reason as string).trim();
      }
    } catch {
      reason = '';
    }

    if (reason === '') return REASON_UNRECORDED;

    return CardScrubber.scrub(reason.slice(0, 120)) as string;
  }

  private static capped(byReason: Record<string, number>): Record<string, number> {
    const entries = Object.entries(byReason);
    if (entries.length <= MAX_REASONS) return byReason;

    const kept = Object.fromEntries(entries.slice(0, MAX_REASONS));
    const otherTotal = entries.slice(MAX_REASONS).reduce((sum, [, count]) => sum + count, 0);
    kept[REASON_OTHER] = otherTotal;

    return kept;
  }

  private async count(read: () => Promise<number>): Promise<Measured> {
    try {
      return Measured.of(await read());
    } catch (error) {
      return Measured.unavailable(error instanceof Error ? error.constructor.name : 'UnknownError');
    }
  }
}
