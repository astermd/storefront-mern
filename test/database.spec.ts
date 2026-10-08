import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Proves the persistence layer's "done" bar: the schema applies cleanly to a fresh database (via
 * `prisma db push`, schema-only sync — no need to spawn the CLI once per test), an insert/select
 * round trip works per table, and the `checkout_attempts.idempotency_key` UNIQUE constraint — the
 * entire double-charge defense per MERN.md's Persistence section — actually rejects a duplicate at
 * the DB layer, before any checkout logic exists to rely on it. `prisma/migrations/` itself (the
 * real migration history) is exercised separately by hand against both SQLite and a real Postgres
 * 16 container while building Phase 3 — see the plan file.
 */
describe('Persistence', () => {
  let prisma: PrismaClient;
  let dbDir: string;

  beforeAll(() => {
    dbDir = mkdtempSync(join(tmpdir(), 'mern-test-db-'));
    const url = `file:${join(dbDir, 'test.sqlite3')}`;

    execFileSync('npx', ['prisma', 'db', 'push', '--url', url, '--accept-data-loss'], {
      cwd: process.cwd(),
      stdio: 'ignore',
    });

    prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    rmSync(dbDir, { recursive: true, force: true });
  });

  it('round-trips a row through sessions', async () => {
    await prisma.session.create({
      data: {
        sessionUuid: 'session-aaaaaaaaaaaaaaaa',
        opportunityId: null,
        journeyState: '{}',
        attribution: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });

    const row = await prisma.session.findUnique({ where: { sessionUuid: 'session-aaaaaaaaaaaaaaaa' } });

    expect(row?.journeyState).toBe('{}');
  });

  it('round-trips a row through orders, order_lines, and order_consents', async () => {
    const order = await prisma.order.create({
      data: {
        sessionUuid: null,
        providerReference: 'prov-ref-1',
        anchorSlug: 'semaglutide',
        amountCents: 5000,
        currency: 'USD',
        status: 'placed',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });

    await prisma.orderLine.create({
      data: {
        orderId: order.id,
        slug: 'semaglutide',
        name: 'Semaglutide',
        kind: 'rx',
        providerOffer: null,
        providerItem: null,
        unitPriceCents: 5000,
        quantity: 1,
      },
    });

    await prisma.orderConsent.create({
      data: {
        orderId: order.id,
        consentKey: 'telehealth',
        granted: 1,
        copyVersion: 'v1',
        copyShown: 'I consent to telehealth treatment.',
        recordedAt: '2026-01-01T00:00:00.000Z',
      },
    });

    const lines = await prisma.orderLine.findMany({ where: { orderId: order.id } });
    const consents = await prisma.orderConsent.findMany({ where: { orderId: order.id } });

    expect(lines).toHaveLength(1);
    expect(consents).toHaveLength(1);
  });

  it('round-trips a row through events', async () => {
    await prisma.event.create({
      data: {
        sessionUuid: 'session-aaaaaaaaaaaaaaaa',
        name: 'session_created',
        payload: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });

    const rows = await prisma.event.findMany({ where: { sessionUuid: 'session-aaaaaaaaaaaaaaaa' } });

    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('round-trips a row through rate_limits', async () => {
    await prisma.rateLimit.create({
      data: { bucket: 'checkout.submit', identity: '1.2.3.4', hits: 1, windowStart: 1700000000 },
    });

    const row = await prisma.rateLimit.findUnique({
      where: { bucket_identity: { bucket: 'checkout.submit', identity: '1.2.3.4' } },
    });

    expect(row?.hits).toBe(1);
  });

  it('round-trips a row through checkout_attempts', async () => {
    await prisma.checkoutAttempt.create({
      data: {
        idempotencyKey: 'idem-key-1',
        sessionKey: 'session-key-1',
        state: 'claimed',
        outcome: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        completedAt: null,
      },
    });

    const row = await prisma.checkoutAttempt.findUnique({ where: { idempotencyKey: 'idem-key-1' } });

    expect(row?.state).toBe('claimed');
  });

  it('rejects a duplicate idempotency_key — the entire double-charge defense', async () => {
    await prisma.checkoutAttempt.create({
      data: {
        idempotencyKey: 'idem-key-dup',
        sessionKey: 'session-key-a',
        state: 'claimed',
        outcome: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        completedAt: null,
      },
    });

    await expect(
      prisma.checkoutAttempt.create({
        data: {
          idempotencyKey: 'idem-key-dup',
          sessionKey: 'session-key-b',
          state: 'claimed',
          outcome: null,
          createdAt: '2026-01-01T00:00:01.000Z',
          completedAt: null,
        },
      }),
    ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
  });

  it('rejects a duplicate (bucket, identity) pair on rate_limits', async () => {
    await prisma.rateLimit.create({ data: { bucket: 'b', identity: 'x', hits: 1, windowStart: 1 } });

    await expect(
      prisma.rateLimit.create({ data: { bucket: 'b', identity: 'x', hits: 2, windowStart: 2 } }),
    ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
  });
});
