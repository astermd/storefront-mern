import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { DATABASE_CONNECTION } from '../core/tokens';
import { PlacementOutcome } from '../payment/placement-outcome';

export interface CheckoutAttemptRow {
  key: string;
  sessionKey: string;
  state: string;
  outcome: Record<string, unknown> | null;
  createdAt: string;
  completedAt: string | null;
}

/**
 * Ported from storefront-lamp/core/Repository/CheckoutAttemptRepository.php. The `checkout_attempts`
 * table: one row per checkout submission, and the thing that stops a second submission becoming a
 * second charge.
 *
 * **Three states, and the middle one is the whole point.** A row is `claimed` before anything is
 * sent, becomes `sent` immediately before the provider is called, and `complete` once an outcome is
 * known. Two states could not tell "this request has not talked to the provider yet" from "this
 * request talked to the provider and never came back", and the difference decides whether the key
 * may be taken over: a claim that died before the call demonstrably charged nothing, while one that
 * died after it may correspond to a real order (`[13.37]`).
 *
 * `createdAt` is an ownership token, not only a timestamp — every write that advances a row, and the
 * delete that releases it, is conditional on the `createdAt` its owner put there, because the key
 * alone cannot say *which* request is asking. Nothing here stores anything about the card.
 */
@Injectable()
export class CheckoutAttemptRepository {
  static readonly STATE_CLAIMED = 'claimed';
  static readonly STATE_SENT = 'sent';
  static readonly STATE_COMPLETE = 'complete';

  constructor(@Inject(DATABASE_CONNECTION) private readonly prisma: PrismaClient) {}

  /**
   * Claims this idempotency key for the current request, or reports that someone else already has
   * it. A conditional insert against a UNIQUE index rather than a select-then-insert: two submits
   * arriving together would both pass a select, and the payment provider offers no duplicate
   * protection of its own.
   */
  async claim(key: string, sessionKey: string, now: string): Promise<boolean> {
    try {
      await this.prisma.checkoutAttempt.create({
        data: { idempotencyKey: key, sessionKey, state: CheckoutAttemptRepository.STATE_CLAIMED, createdAt: now },
      });
      return true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return false;
      }
      throw e;
    }
  }

  /** The attempt held against this key, or null when nobody has claimed it. */
  async outcomeFor(key: string): Promise<CheckoutAttemptRow | null> {
    const row = await this.prisma.checkoutAttempt.findUnique({ where: { idempotencyKey: key } });
    if (row === null) return null;

    let outcome: Record<string, unknown> | null = null;
    if (row.outcome !== null) {
      try {
        const parsed: unknown = JSON.parse(row.outcome);
        outcome = parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
      } catch {
        outcome = null;
      }
    }

    return {
      key: row.idempotencyKey,
      sessionKey: row.sessionKey,
      state: row.state,
      outcome,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
    };
  }

  /**
   * Takes over a claim old enough to have been abandoned, in place — an in-place conditional update
   * rather than a delete-then-insert, which is what caused a real double charge (see PHP source
   * comment history): the row itself is the serialisation point, so exactly one concurrent taker
   * wins. Only a `claimed` row is ever eligible, whatever `observedAt` says — a `sent` row belongs
   * to a request that has already reached a provider with no idempotency of its own.
   */
  async renewClaim(key: string, sessionKey: string, now: string, observedAt: string): Promise<boolean> {
    const result = await this.prisma.checkoutAttempt.updateMany({
      where: { idempotencyKey: key, state: CheckoutAttemptRepository.STATE_CLAIMED, createdAt: observedAt },
      data: { sessionKey, createdAt: now },
    });
    return result.count === 1;
  }

  /**
   * Records that this attempt is now with the provider — called *before* the call, not after,
   * because the row only has to be wrong for the width of one network round trip for a retry to
   * charge a second time.
   *
   * @throws Error (a `DomainException` analogue) when the claim this caller made is no longer the
   * one on the row — the caller must NOT release the key in that case, since the row is somebody
   * else's.
   */
  async markSent(key: string, claimedAt: string): Promise<void> {
    const result = await this.prisma.checkoutAttempt.updateMany({
      where: { idempotencyKey: key, state: CheckoutAttemptRepository.STATE_CLAIMED, createdAt: claimedAt },
      data: { state: CheckoutAttemptRepository.STATE_SENT },
    });

    if (result.count !== 1) {
      throw new CheckoutAttemptTakenOver('The checkout attempt claimed by this request is no longer held by it.');
    }
  }

  /**
   * Completes the attempt with what the provider said. No count check and no exception, unlike
   * `markSent()`: by the time this runs the provider has answered and the card may be debited, so a
   * caller that raised here would turn a stored outcome into an error page in front of a buyer whose
   * money has moved. Matching nothing is the safe direction.
   */
  async recordOutcome(key: string, outcome: Record<string, unknown>): Promise<void> {
    await this.prisma.checkoutAttempt.updateMany({
      where: { idempotencyKey: key, state: CheckoutAttemptRepository.STATE_SENT },
      data: { state: CheckoutAttemptRepository.STATE_COMPLETE, outcome: JSON.stringify(outcome), completedAt: new Date().toISOString() },
    });
  }

  /**
   * Gives the key back, so the same submission may be tried again. Only the request that owns the
   * row may delete it (`claimedAt` is the ownership token) — an unconditional delete was the root
   * cause of a real double charge in the PHP original's history. No count check, deliberately: a
   * release that matched nothing is the correct no-op.
   */
  async release(key: string, claimedAt: string): Promise<void> {
    await this.prisma.checkoutAttempt.deleteMany({ where: { idempotencyKey: key, createdAt: claimedAt } });
  }

  /**
   * Ported for `db:prune` (Phase 10, deferred from Phase 7's original build — see this class's own
   * doc comment history). Deletes aged `claimed` rows outright, plus aged `complete` rows that are
   * "replaceable" — see `replaceableCompletionKeys()`. A `sent` row is never deleted at any age: the
   * provider was contacted and never answered, and no amount of time settles whether money moved.
   */
  async expire(before: string): Promise<number> {
    const claimed = await this.prisma.checkoutAttempt.deleteMany({
      where: { state: CheckoutAttemptRepository.STATE_CLAIMED, createdAt: { lt: before } },
    });

    const replaceableKeys = await this.replaceableCompletionKeys(before);
    const completions =
      replaceableKeys.length > 0 ? await this.prisma.checkoutAttempt.deleteMany({ where: { idempotencyKey: { in: replaceableKeys } } }) : { count: 0 };

    return claimed.count + completions.count;
  }

  /** Must mirror `expire()`'s predicate exactly, so a dry run and the delete it precedes describe the same sweep. */
  async countExpirable(before: string): Promise<number> {
    const claimed = await this.prisma.checkoutAttempt.count({
      where: { state: CheckoutAttemptRepository.STATE_CLAIMED, createdAt: { lt: before } },
    });

    const replaceableKeys = await this.replaceableCompletionKeys(before);
    return claimed + replaceableKeys.length;
  }

  /** `sent` rows older than the cutoff — never expired by `expire()`, only reported: each is a call the provider never answered. */
  async countUnresolved(before: string): Promise<number> {
    return this.prisma.checkoutAttempt.count({ where: { state: CheckoutAttemptRepository.STATE_SENT, createdAt: { lt: before } } });
  }

  /**
   * Aged `complete` rows that are safe to delete: their stored outcome decodes and is not
   * `PENDING_ACTION` — a "challenge" outcome the buyer may still be resolving. An outcome that fails
   * to decode counts as a challenge too and is kept, on the same fail-closed reasoning as everything
   * else in this class.
   */
  private async replaceableCompletionKeys(before: string): Promise<string[]> {
    const rows = await this.prisma.checkoutAttempt.findMany({
      where: { state: CheckoutAttemptRepository.STATE_COMPLETE, createdAt: { lt: before } },
      select: { idempotencyKey: true, outcome: true },
    });

    return rows.filter((row) => CheckoutAttemptRepository.isReplaceable(row.outcome)).map((row) => row.idempotencyKey);
  }

  private static isReplaceable(outcomeJson: string | null): boolean {
    if (outcomeJson === null) return false;

    try {
      const parsed: unknown = JSON.parse(outcomeJson);
      if (parsed !== null && typeof parsed === 'object' && 'state' in parsed) {
        return (parsed as { state: unknown }).state !== PlacementOutcome.PENDING_ACTION;
      }
    } catch {
      // Undecodable — counts as a challenge and is kept.
    }

    return false;
  }
}

/**
 * Distinct from a driver failure (which the caller must treat as "the database is unwell"): this
 * means "my row is gone", and the caller must not release a key it no longer owns.
 */
export class CheckoutAttemptTakenOver extends Error {}
