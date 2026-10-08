import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { AbandonmentSweep } from '../src/abandonment/abandonment-sweep';
import { NullCheckoutEventReporter } from '../src/checkout/null-checkout-event-reporter';
import { ForwardReconciliation } from '../src/reconciliation/forward-reconciliation';
import { OperationalCounts } from '../src/observability/operational-counts';
import { RetentionSweep } from '../src/retention/retention-sweep';
import { EventRepository } from '../src/repository/event-repository';
import { OrderRepository } from '../src/repository/order-repository';
import { SessionRepository } from '../src/repository/session-repository';
import { ConfigService } from '../src/support/config';
import { OperatorLog } from '../src/support/operator-log';

/**
 * The plan's Phase 10 "Done" bar: `abandonment:signals`/`db:prune`/`ops:status`-backing sweeps
 * produce correct counts against seeded fixtures — a real, temp-file SQLite database rather than
 * mocks, since the whole point of these sweeps is the SQL predicate (which sessions/orders a sweep
 * does and does not touch).
 */
describe('Phase 10 sweeps', () => {
  let prisma: PrismaClient;
  let dbDir: string;
  let config: ConfigService;
  let log: OperatorLog;

  const now = Math.floor(Date.now() / 1000);
  const iso = (secondsAgo: number) => new Date((now - secondsAgo) * 1000).toISOString();

  beforeAll(() => {
    dbDir = mkdtempSync(join(tmpdir(), 'mern-test-phase10-'));
    const url = `file:${join(dbDir, 'test.sqlite3')}`;

    execFileSync('npx', ['prisma', 'db', 'push', '--url', url, '--accept-data-loss'], { cwd: process.cwd(), stdio: 'ignore' });

    prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
    config = new ConfigService();
    log = new OperatorLog(join(dbDir, 'app.log'));
  });

  afterAll(async () => {
    await prisma.$disconnect();
    rmSync(dbDir, { recursive: true, force: true });
  });

  describe('AbandonmentSweep', () => {
    it('reports only the session that has stopped moving inside the lookback window, classified correctly', async () => {
      // Idle long enough (default idleSeconds=3600) and inside the lookback (default 30 days):
      // populated cart, no further steps -> cart_abandoned.
      await prisma.session.create({
        data: {
          sessionUuid: 'abandon-cart',
          journeyState: JSON.stringify({ cart: { lines: [{ slug: 'a', name: 'A', kind: 'otc', emr_product_id: null, parent_slug: null, quantity: 1, unit_price_cents: 100, variant_id: null }], territory: null } }),
          attribution: null,
          createdAt: iso(7200),
          updatedAt: iso(7200),
        },
      });

      // Too recent — inside the idle window — must not appear even though its cart is populated.
      await prisma.session.create({
        data: {
          sessionUuid: 'too-recent',
          journeyState: JSON.stringify({ cart: { lines: [{ slug: 'a', name: 'A', kind: 'otc', emr_product_id: null, parent_slug: null, quantity: 1, unit_price_cents: 100, variant_id: null }], territory: null } }),
          attribution: null,
          createdAt: iso(10),
          updatedAt: iso(10),
        },
      });

      // A completed journey — must never appear, regardless of age.
      await prisma.session.create({
        data: {
          sessionUuid: 'completed',
          journeyState: JSON.stringify({ completedAt: iso(7200), placedOrders: ['ref-1'] }),
          attribution: null,
          createdAt: iso(7200),
          updatedAt: iso(7200),
        },
      });

      const sweep = new AbandonmentSweep(new SessionRepository(prisma), new EventRepository(prisma), config);
      const signals = await sweep.signals();

      const uuids = signals.map((s) => s.sessionUuid);
      expect(uuids).toContain('abandon-cart');
      expect(uuids).not.toContain('too-recent');
      expect(uuids).not.toContain('completed');

      const cartSignal = signals.find((s) => s.sessionUuid === 'abandon-cart');
      expect(cartSignal?.state).toBe('cart_abandoned');

      // `[30.7]`: every emitted signal writes an access-audit event row.
      const auditRows = await prisma.event.findMany({ where: { sessionUuid: 'abandon-cart', name: 'access.abandonment_signal' } });
      expect(auditRows).toHaveLength(1);
    });
  });

  describe('RetentionSweep', () => {
    it('never expires a session an orders row references, at any age', async () => {
      await prisma.session.create({
        data: { sessionUuid: 'retain-held', journeyState: '{}', attribution: null, createdAt: iso(365 * 86_400), updatedAt: iso(365 * 86_400) },
      });
      await prisma.order.create({
        data: {
          sessionUuid: 'retain-held',
          providerReference: 'ref-held',
          anchorSlug: 'a',
          amountCents: 100,
          currency: 'USD',
          status: 'placed',
          createdAt: iso(365 * 86_400),
          updatedAt: iso(365 * 86_400),
        },
      });

      await prisma.session.create({
        data: { sessionUuid: 'retain-free', journeyState: '{}', attribution: null, createdAt: iso(365 * 86_400), updatedAt: iso(365 * 86_400) },
      });

      const sweep = new RetentionSweep(prisma);
      const cutoff = iso(86_400); // 1 day ago — both seeded sessions are far older than this

      const heldByOrders = await sweep.countSessionsHeldByOrders(cutoff);
      expect(heldByOrders).toBeGreaterThanOrEqual(1);

      const expirable = await sweep.countExpirableSessions(cutoff);
      const deleted = await sweep.expireSessions(cutoff);
      expect(deleted).toBe(expirable);

      const stillThere = await prisma.session.findUnique({ where: { sessionUuid: 'retain-held' } });
      expect(stillThere).not.toBeNull();

      const freeGone = await prisma.session.findUnique({ where: { sessionUuid: 'retain-free' } });
      expect(freeGone).toBeNull();
    });
  });

  describe('ForwardReconciliation', () => {
    it('separates the backlog (has a session, past grace) from the unreconcilable (no session at all)', async () => {
      await prisma.session.create({ data: { sessionUuid: 'fwd-session', journeyState: '{}', attribution: null, createdAt: iso(2000), updatedAt: iso(2000) } });
      await prisma.session.create({ data: { sessionUuid: 'fwd-inside-grace', journeyState: '{}', attribution: null, createdAt: iso(60), updatedAt: iso(60) } });

      await prisma.order.create({
        data: {
          sessionUuid: 'fwd-session',
          providerReference: 'fwd-backlog',
          anchorSlug: 'a',
          amountCents: 100,
          currency: 'USD',
          status: 'placed',
          placedAt: iso(2000), // past the 900s grace window
          createdAt: iso(2000),
          updatedAt: iso(2000),
        },
      });
      await prisma.order.create({
        data: {
          sessionUuid: null,
          providerReference: 'fwd-no-session',
          anchorSlug: 'a',
          amountCents: 100,
          currency: 'USD',
          status: 'placed',
          placedAt: iso(2000),
          createdAt: iso(2000),
          updatedAt: iso(2000),
        },
      });
      await prisma.order.create({
        data: {
          sessionUuid: 'fwd-inside-grace',
          providerReference: 'fwd-too-fresh',
          anchorSlug: 'a',
          amountCents: 100,
          currency: 'USD',
          status: 'placed',
          placedAt: iso(60), // inside the 900s grace window — not backlog yet
          createdAt: iso(60),
          updatedAt: iso(60),
        },
      });

      const reconciliation = new ForwardReconciliation(new OrderRepository(prisma), new NullCheckoutEventReporter(), log);
      const report = await reconciliation.run(false);

      expect(report.dryRun).toBe(true);
      expect(report.unsynced).toBeGreaterThanOrEqual(3);
      expect(report.backlog).toBeGreaterThanOrEqual(1);
      expect(report.unreconcilable).toBeGreaterThanOrEqual(1);

      // Disjoint: the no-session order counts toward unreconcilable, never toward backlog.
      const backlogRows = await new OrderRepository(prisma).findUnsyncedPlacedBefore(iso(900), 200);
      const backlogRefs = backlogRows.filter((r) => r.sessionUuid !== null).map((r) => r.providerReference);
      expect(backlogRefs).toContain('fwd-backlog');
      expect(backlogRefs).not.toContain('fwd-no-session');
    });
  });

  describe('OperationalCounts', () => {
    it('counts checkouts without an EMR session apart from every checkout reached', async () => {
      await prisma.event.create({ data: { sessionUuid: '', name: 'checkout.visited', payload: null, createdAt: iso(10) } });
      await prisma.event.create({ data: { sessionUuid: 'has-session', name: 'checkout.visited', payload: null, createdAt: iso(10) } });

      const counts = new OperationalCounts(prisma);
      const without = await counts.checkoutsWithoutEmrSession();
      const reached = await counts.checkoutsReached();

      expect(without.available()).toBe(true);
      expect(reached.available()).toBe(true);
      expect(without.value).toBeGreaterThanOrEqual(1);
      expect(reached.value).toBeGreaterThanOrEqual(without.value ?? 0);
    });

    it('reads the decline rate from the local trail, scrubbing the stored reason', async () => {
      await prisma.event.create({ data: { sessionUuid: 'decline-1', name: 'checkout.order_declined', payload: JSON.stringify({ reason: 'card declined' }), createdAt: iso(5) } });
      await prisma.event.create({ data: { sessionUuid: 'placed-1', name: 'checkout.order_placed', payload: null, createdAt: iso(5) } });

      const counts = new OperationalCounts(prisma);
      const declines = await counts.declines();

      expect(declines.available()).toBe(true);
      expect(declines.total).toBeGreaterThanOrEqual(1);
      expect(declines.attempts).toBeGreaterThanOrEqual(2);
      expect(Object.keys(declines.byReason ?? {})).toContain('card declined');
    });
  });
});
