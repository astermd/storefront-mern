import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import {
  SCOPE_LINE_ITEM,
  STRATEGY_TOKENIZATION,
  SURFACE_THEME_FIELDS,
  AdapterCapabilities,
} from '../../src/payment/adapter-capabilities';
import { CaptureOrderCommand } from '../../src/console/capture-order.command';
import { CaptureOutcome } from '../../src/payment/capture-outcome';
import { CaptureRequest } from '../../src/payment/capture-request';
import { OrderEnvelope } from '../../src/payment/order-envelope';
import { OrderSearch } from '../../src/payment/order-search';
import { OrderSearchResult } from '../../src/payment/order-search-result';
import { PaymentAdapter } from '../../src/payment/payment-adapter';
import { PaymentCredential } from '../../src/payment/payment-credential';
import { PlacementOutcome } from '../../src/payment/placement-outcome';
import { PromotionQuote } from '../../src/payment/promotion-quote';
import { OrderRepository } from '../../src/repository/order-repository';

class StubAdapter implements PaymentAdapter {
  supportsAuthorizeCapture = true;
  captureResult: CaptureOutcome = CaptureOutcome.captured('ref-1');
  capturedRequest: CaptureRequest | null = null;

  capabilities(): AdapterCapabilities {
    return new AdapterCapabilities('vrio', false, SCOPE_LINE_ITEM, STRATEGY_TOKENIZATION, SURFACE_THEME_FIELDS, [], [], 'test', false, false, false, this.supportsAuthorizeCapture);
  }

  async place(_order: OrderEnvelope, _credential: PaymentCredential): Promise<PlacementOutcome> {
    throw new Error('not used');
  }

  async resume(reference: string): Promise<PlacementOutcome> {
    return PlacementOutcome.declined(reference, 'Test double; resume is not exercised here.', 'unsupported');
  }

  async quotePromotion(_order: OrderEnvelope, code: string): Promise<PromotionQuote> {
    return PromotionQuote.rejected(code, 'unused');
  }

  async searchOrders(_search: OrderSearch): Promise<OrderSearchResult> {
    return OrderSearchResult.unsupported();
  }

  async capture(request: CaptureRequest): Promise<CaptureOutcome> {
    this.capturedRequest = request;
    return this.captureResult;
  }

  async ping(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: 'test' };
  }
}

/**
 * Proves Phase 10's `payment:capture` command against the PHP original's own test scenarios:
 * missing reference, no local order, an order not recorded as an authorization, an adapter that
 * can't authorize-and-capture, a successful capture, and a provider refusal — each asserted by
 * exit code, matching the PHP CLI's own "exit code is the interface" design.
 */
describe('CaptureOrderCommand', () => {
  let prisma: PrismaClient;
  let dbDir: string;
  let orders: OrderRepository;

  beforeAll(() => {
    dbDir = mkdtempSync(join(tmpdir(), 'mern-test-capture-'));
    const url = `file:${join(dbDir, 'test.sqlite3')}`;
    execFileSync('npx', ['prisma', 'db', 'push', '--url', url, '--accept-data-loss'], { cwd: process.cwd(), stdio: 'ignore' });
    prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
    orders = new OrderRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    rmSync(dbDir, { recursive: true, force: true });
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  async function insertOrder(reference: string, settlement: 'authorize' | 'capture', promotionCode: string | null = null): Promise<void> {
    await orders.insert(
      { provider_reference: reference, anchor_slug: 'semaglutide', amount_cents: 5000, currency: 'USD', status: 'placed', settlement, promotion_code: promotionCode },
      [{ slug: 'semaglutide', name: 'Semaglutide', provider_offer: 'offer-1', provider_item: 'item-1', unit_price_cents: 5000, quantity: 1 }],
      [],
    );
  }

  it('refuses an empty reference without touching the adapter', async () => {
    const adapter = new StubAdapter();
    const command = new CaptureOrderCommand(adapter, orders);

    await command.run(['']);

    expect(process.exitCode).toBe(1);
    expect(adapter.capturedRequest).toBeNull();
  });

  it('refuses a reference with no local order', async () => {
    const adapter = new StubAdapter();
    const command = new CaptureOrderCommand(adapter, orders);

    await command.run(['no-such-ref']);

    expect(process.exitCode).toBe(1);
    expect(adapter.capturedRequest).toBeNull();
  });

  it('refuses an order recorded as capture, not authorize', async () => {
    await insertOrder('ref-captured', 'capture');
    const adapter = new StubAdapter();
    const command = new CaptureOrderCommand(adapter, orders);

    await command.run(['ref-captured']);

    expect(process.exitCode).toBe(1);
    expect(adapter.capturedRequest).toBeNull();
  });

  it('refuses when the adapter does not support authorize-and-capture', async () => {
    await insertOrder('ref-unsupported-adapter', 'authorize');
    const adapter = new StubAdapter();
    adapter.supportsAuthorizeCapture = false;
    const command = new CaptureOrderCommand(adapter, orders);

    await command.run(['ref-unsupported-adapter']);

    expect(process.exitCode).toBe(1);
    expect(adapter.capturedRequest).toBeNull();
  });

  it('captures an authorized order and exits 0, rebuilding lines from the local row', async () => {
    await insertOrder('ref-captures-ok', 'authorize');
    const adapter = new StubAdapter();
    adapter.captureResult = CaptureOutcome.captured('ref-captures-ok');
    const command = new CaptureOrderCommand(adapter, orders);

    await command.run(['ref-captures-ok']);

    expect(process.exitCode).toBeUndefined();
    expect(adapter.capturedRequest?.reference).toBe('ref-captures-ok');
    expect(adapter.capturedRequest?.lines).toHaveLength(1);
    expect(adapter.capturedRequest?.lines[0].providerOffer).toBe('offer-1');
    expect(adapter.capturedRequest?.lines[0].providerItem).toBe('item-1');
  });

  it('hands the order\'s recorded promotion code to the adapter, and null when it had none', async () => {
    await insertOrder('ref-with-code', 'authorize', 'SAVE10');
    await insertOrder('ref-no-code', 'authorize');
    const adapter = new StubAdapter();
    const command = new CaptureOrderCommand(adapter, orders);

    await command.run(['ref-with-code']);
    expect(adapter.capturedRequest?.promotionCode).toBe('SAVE10');

    await command.run(['ref-no-code']);
    expect(adapter.capturedRequest?.promotionCode).toBeNull();
  });

  it('exits 1 when the provider refuses the capture', async () => {
    await insertOrder('ref-capture-fails', 'authorize');
    const adapter = new StubAdapter();
    adapter.captureResult = CaptureOutcome.failed('ref-capture-fails', 'order_unauthorized');
    const command = new CaptureOrderCommand(adapter, orders);

    await command.run(['ref-capture-fails']);

    expect(process.exitCode).toBe(1);
  });
});
