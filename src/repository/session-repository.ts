import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { DATABASE_CONNECTION } from '../core/tokens';
import { AttributionData } from '../journey/attribution';
import { JourneyStateData } from '../journey/journey-state';

export interface SessionRow {
  journeyState: Partial<JourneyStateData>;
  attribution: AttributionData | null;
  opportunityId: string | null;
  updatedAt: string;
}

export type SaveOutcome = 'ok' | 'conflict' | 'not_found';

/**
 * Ported from storefront-lamp/core/Repository/SessionRepository.php — the only code that touches
 * the `sessions` table. `JourneyStore` (its only caller) is written against this class's public
 * API and is unaware of the persistence layer beneath it — Prisma now, Kysely with an in-process
 * `Map` before that, in each case with no call-site changes.
 */
@Injectable()
export class SessionRepository {
  constructor(@Inject(DATABASE_CONNECTION) private readonly prisma: PrismaClient) {}

  async find(uuid: string): Promise<SessionRow | null> {
    const row = await this.prisma.session.findUnique({
      where: { sessionUuid: uuid },
      select: { journeyState: true, attribution: true, opportunityId: true, updatedAt: true },
    });

    if (!row) return null;

    return {
      journeyState: SessionRepository.decode(row.journeyState) ?? {},
      attribution: row.attribution === null ? null : SessionRepository.decode(row.attribution),
      opportunityId: row.opportunityId,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Creates the row for a newly minted, adopted or re-minted session. Does nothing on conflict —
   * an existing row already holds this journey's history, and this method's job is to guarantee a
   * row exists, not to overwrite one. Prisma has no engine-agnostic "ON CONFLICT DO NOTHING", so
   * this catches the unique-constraint violation (`P2002`) instead — the conflict clause replaces
   * a find-then-insert pair, which would leave a window where two concurrent requests for one
   * session could both decide the row was absent.
   */
  /** @returns the row's stamped `updatedAt` — the freshly created one, or the existing row's on a no-op conflict. */
  async insert(
    uuid: string,
    journeyState: Partial<JourneyStateData>,
    attribution: AttributionData | null,
    opportunityId: string | null = null,
  ): Promise<string> {
    const now = new Date().toISOString();

    try {
      await this.prisma.session.create({
        data: {
          sessionUuid: uuid,
          opportunityId,
          journeyState: SessionRepository.encode(journeyState),
          attribution: attribution === null ? null : SessionRepository.encode(attribution),
          createdAt: now,
          updatedAt: now,
        },
      });
      return now;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.prisma.session.findUnique({ where: { sessionUuid: uuid }, select: { updatedAt: true } });
        return existing?.updatedAt ?? now;
      }
      throw e;
    }
  }

  /**
   * Writes the journey's durable state back over an existing row.
   *
   * `expectedUpdatedAt`, when given, is an optimistic-concurrency token: the write only lands if
   * the row's `updatedAt` still matches what the caller's `JourneyState` was loaded from. Without
   * this, two requests for the same session that both read-modify-write the *whole* state (this
   * storefront's only write shape — there is no per-field update) can race: whichever's write
   * lands last wins outright, silently discarding whatever the other had just added, however long
   * ago it read its own (by-then-stale) copy. Confirmed live: a slow intake save (a real EMR call
   * in the middle of it) was still in flight when a checkout page visit read the session, and the
   * checkout request's own flush — which runs *after* the intake save's, but from a snapshot taken
   * *before* it — overwrote the just-saved answers with its own, older copy. `null` skips the
   * check (used only for a state that was `adopt()`ed straight from a mint, never loaded from a
   * row that could already have a concurrent reader).
   *
   * @returns `'not_found'` when the row is gone outright (a failed earlier insert, a reset
   * database, one removed by retention); `'conflict'` when it exists but `updatedAt` moved since
   * this journey was loaded — the caller (`JourneyStore.flush()`) re-reads and retries once rather
   * than either overwriting the newer write or giving up. `updateMany()` reports zero rows matched
   * for both cases rather than throwing, which is what lets them be told apart with one more read
   * instead of Prisma's `update()`'s single `P2025` for "not found".
   */
  async save(
    uuid: string,
    journeyState: Partial<JourneyStateData>,
    attribution: AttributionData | null,
    opportunityId: string | null,
    expectedUpdatedAt: string | null,
  ): Promise<{ outcome: SaveOutcome; updatedAt: string | null }> {
    const updatedAt = new Date().toISOString();
    const where = expectedUpdatedAt === null ? { sessionUuid: uuid } : { sessionUuid: uuid, updatedAt: expectedUpdatedAt };

    const result = await this.prisma.session.updateMany({
      where,
      data: {
        journeyState: SessionRepository.encode(journeyState),
        attribution: attribution === null ? null : SessionRepository.encode(attribution),
        opportunityId,
        updatedAt,
      },
    });

    if (result.count > 0) return { outcome: 'ok', updatedAt };

    const stillExists = await this.prisma.session.findUnique({ where: { sessionUuid: uuid }, select: { sessionUuid: true } });
    return { outcome: stillExists === null ? 'not_found' : 'conflict', updatedAt: null };
  }

  /**
   * Sessions last moved inside `[earliest, latest]`, oldest first — `AbandonmentSweep`'s one query.
   * `updatedAt` is a genuine "last moved" timestamp, not "last seen", because `JourneyStore.flush()`
   * compares a fingerprint of the durable state and writes nothing when it has not changed.
   */
  async findLastMovedBetween(earliest: string, latest: string, limit: number): Promise<Array<SessionRow & { sessionUuid: string; updatedAt: string }>> {
    const rows = await this.prisma.session.findMany({
      where: { updatedAt: { gte: earliest, lte: latest } },
      orderBy: { updatedAt: 'asc' },
      take: Math.max(1, limit),
      select: { sessionUuid: true, opportunityId: true, journeyState: true, attribution: true, updatedAt: true },
    });

    return rows.map((row) => ({
      sessionUuid: row.sessionUuid,
      opportunityId: row.opportunityId,
      journeyState: SessionRepository.decode(row.journeyState) ?? {},
      attribution: row.attribution === null ? null : SessionRepository.decode(row.attribution),
      updatedAt: row.updatedAt,
    }));
  }

  private static encode(value: unknown): string {
    return JSON.stringify(value);
  }

  private static decode<T>(value: string): T | null {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed === null ? null : (parsed as T);
    } catch {
      return null;
    }
  }
}
