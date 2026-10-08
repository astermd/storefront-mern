import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { DATABASE_CONNECTION } from '../core/tokens';

/**
 * Ported from storefront-lamp/core/Retention/RetentionSweep.php. `[30.6]`'s expiry of the two
 * operational tables that live in the database: `sessions` and `events`.
 *
 * **Why this is not a method on each repository.** Expiring a session is not a question about
 * `sessions` alone — it is a question about `sessions` *and* `orders`, because the only thing
 * standing between this sweep and an unreconcilable charge is a join neither repository would
 * naturally carry.
 *
 * **The refusal is the interesting half.** A session row referenced by any `orders` row is never
 * taken, at any age. A deleted session is simultaneously a journey that can no longer be resumed and
 * an order that can no longer be attributed to the person who placed it. Age cannot settle that, so
 * age is not asked — those rows are counted and reported instead (`countSessionsHeldByOrders`).
 *
 * **Events outlive the sessions they describe**, so the session sweep does not cascade into them —
 * `[30.7]` makes the trail the record of who read health information, and a breach investigation that
 * starts after the sessions have aged out still needs it.
 *
 * The `orders.none`/`orders.some` relation filters below are the direct equivalent of the PHP
 * original's `session_uuid NOT IN (SELECT session_uuid FROM orders WHERE session_uuid IS NOT NULL)`
 * — a relation only forms for a non-null `sessionUuid`, so an order with no session link can never
 * make this sweep a no-op the way a raw `NOT IN` with a NULL in the list would.
 *
 * Nothing here is swallowed. Unlike the `[30.7]` audit write, a failed delete is something the
 * operator scheduling this must hear about.
 */
@Injectable()
export class RetentionSweep {
  constructor(@Inject(DATABASE_CONNECTION) private readonly prisma: PrismaClient) {}

  /** How many session rows `expireSessions()` would take. Shares that method's predicate. */
  async countExpirableSessions(movedBefore: string): Promise<number> {
    return this.prisma.session.count({ where: { updatedAt: { lt: movedBefore }, orders: { none: {} } } });
  }

  async expireSessions(movedBefore: string): Promise<number> {
    const result = await this.prisma.session.deleteMany({ where: { updatedAt: { lt: movedBefore }, orders: { none: {} } } });
    return result.count;
  }

  /**
   * Sessions past their period that an order holds back — the complement of `countExpirableSessions()`
   * over the same age window, so the two together account for every aged row.
   */
  async countSessionsHeldByOrders(movedBefore: string): Promise<number> {
    return this.prisma.session.count({ where: { updatedAt: { lt: movedBefore }, orders: { some: {} } } });
  }

  async countExpirableEvents(createdBefore: string): Promise<number> {
    return this.prisma.event.count({ where: { createdAt: { lt: createdBefore } } });
  }

  async expireEvents(createdBefore: string): Promise<number> {
    const result = await this.prisma.event.deleteMany({ where: { createdAt: { lt: createdBefore } } });
    return result.count;
  }
}
