import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { CatalogProvider } from '../../src/catalog/catalog-provider';
import { DATABASE_CONNECTION, PAYMENT_ADAPTER, SESSION_GATEWAY } from '../../src/core/tokens';
import { AdapterCapabilities, SCOPE_LINE_ITEM, STRATEGY_TOKENIZATION, SURFACE_THEME_FIELDS } from '../../src/payment/adapter-capabilities';
import { CaptureOutcome } from '../../src/payment/capture-outcome';
import { CaptureRequest } from '../../src/payment/capture-request';
import { OrderEnvelope } from '../../src/payment/order-envelope';
import { OrderSearch } from '../../src/payment/order-search';
import { OrderSearchResult } from '../../src/payment/order-search-result';
import { PaymentAdapter } from '../../src/payment/payment-adapter';
import { PaymentCredential } from '../../src/payment/payment-credential';
import { PlacementOutcome } from '../../src/payment/placement-outcome';
import { PromotionQuote } from '../../src/payment/promotion-quote';
import { FakeCatalogProvider } from '../support/fake-catalog-provider';
import { FakeSessionGateway } from '../support/fake-session-gateway';
import { createTestApp } from '../support/test-app';

const PRODUCT_SLUG = 'test-otc-item';
let reference = 0;

/** Always places, at a synthesised incrementing reference — this port has no real payment provider (see MERN.md), so this stub is what stands in for "the provider approved it" across Phase 7/8's tests. */
class StubPlacingAdapter implements PaymentAdapter {
  capabilities(): AdapterCapabilities {
    return new AdapterCapabilities('test-stub', false, SCOPE_LINE_ITEM, STRATEGY_TOKENIZATION, SURFACE_THEME_FIELDS, [], [], 'Test stub adapter.', false, false, false, false, []);
  }

  async place(_order: OrderEnvelope, _credential: PaymentCredential): Promise<PlacementOutcome> {
    reference += 1;
    return PlacementOutcome.placed(`stub-ref-${reference}`);
  }

  async resume(reference: string): Promise<PlacementOutcome> {
    return PlacementOutcome.declined(reference, 'Test double; resume is not exercised here.', 'unsupported');
  }

  async quotePromotion(_order: OrderEnvelope, code: string): Promise<PromotionQuote> {
    return PromotionQuote.rejected(code, 'unsupported');
  }

  async searchOrders(_search: OrderSearch): Promise<OrderSearchResult> {
    return OrderSearchResult.unsupported();
  }

  async capture(_request: CaptureRequest): Promise<CaptureOutcome> {
    return CaptureOutcome.unsupported();
  }

  async ping(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: 'stub' };
  }
}

/**
 * Proves Phase 7 + Phase 8's "done" bar end to end, against a real migrated database (unlike the
 * default in-memory test DB — see `test/jest.setup.ts` — this test pushes the real schema to a
 * throwaway temp SQLite file, the same way `test/database.spec.ts` does): a checkout submission
 * that reaches a payment adapter which actually places the order clears the cart, lands on the
 * upsell step, and — since `config/upsells.ts` ships empty — falls straight through to the receipt,
 * which renders the real order and fires exactly once (a second visit replays the frozen snapshot).
 *
 * `PRODUCT_CATALOG` is overridden with one OTC product carrying a real provider mapping — the
 * shipped example catalog has none (a documented Phase 5/6 gap), so every priced line there declines
 * as unmapped before ever reaching an adapter (see `STATUS.md`'s Phase 7 section).
 */
describe('Checkout -> upsell -> receipt (Phase 7 + 8)', () => {
  let app: NestExpressApplication;
  let agent: ReturnType<typeof request.agent>;
  let prisma: PrismaClient;
  let dbDir: string;

  beforeAll(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'mern-test-checkout-db-'));
    const url = `file:${join(dbDir, 'test.sqlite3')}`;

    execFileSync('npx', ['prisma', 'db', 'push', '--url', url, '--accept-data-loss'], { cwd: process.cwd(), stdio: 'ignore' });
    prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

    const catalog = new FakeCatalogProvider([
      {
        slug: PRODUCT_SLUG,
        name: 'Test OTC Item',
        kind: 'otc',
        price_cents: 2500,
        image: '/assets/media/test-otc.jpg',
        variants: [{ id: 'default', name: 'Standard', price_cents: 2500, provider: { offer_id: 'offer-1', product_id: 'product-1' } }],
      },
    ]);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(prisma)
      .overrideProvider(CatalogProvider)
      .useValue(catalog)
      .overrideProvider(PAYMENT_ADAPTER)
      .useValue(new StubPlacingAdapter())
      .overrideProvider(SESSION_GATEWAY)
      .useValue(new FakeSessionGateway())
      .compile();

    app = await createTestApp(moduleRef);
    agent = request.agent(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    rmSync(dbDir, { recursive: true, force: true });
  });

  function extractCsrf(html: string): string {
    const match = html.match(/name="_csrf" value="([^"]+)"/);
    if (!match) throw new Error('No CSRF token found in response body');
    return match[1];
  }

  it('places the order, clears the cart, and reaches a receipt that fires exactly once', async () => {
    const productPage = await agent.get(`/products/${PRODUCT_SLUG}/`);
    let csrf = extractCsrf(productPage.text);

    const added = await agent.post('/cart/add').type('form').redirects(0).send({ _csrf: csrf, slug: PRODUCT_SLUG, quantity: 1 });
    expect(added.status).toBe(303);

    const checkoutPage = await agent.get('/checkout/');
    expect(checkoutPage.status).toBe(200);
    expect(checkoutPage.text).toContain('Test OTC Item');
    csrf = extractCsrf(checkoutPage.text);

    const submitted = await agent
      .post('/checkout')
      .type('form')
      .redirects(0)
      .send({
        _csrf: csrf,
        first_name: 'Jane',
        last_name: 'Doe',
        email: 'jane@example.com',
        phone: '5551234567',
        address_line: '123 Main St',
        city: 'Springfield',
        territory: 'NY',
        postal_code: '10001',
        card_number: '4111111111111111',
        card_expiry: '12/30',
        card_cvc: '123',
        consents: { terms: '1' },
      });

    expect(submitted.status).toBe(303);
    expect(submitted.headers.location).toBe('/upsell/');

    // No upsells are configured (`config/upsells.ts` ships empty), so the queue is spent immediately.
    const upsellPage = await agent.get('/upsell/').redirects(0);
    expect(upsellPage.status).toBe(303);
    expect(upsellPage.headers.location).toBe('/thank-you/');

    const receipt = await agent.get('/thank-you/');
    expect(receipt.status).toBe(200);
    expect(receipt.text).toContain('Thank you');
    expect(receipt.text).toContain('Test OTC Item');
    expect(receipt.text).toContain('stub-ref-');

    // Fire-once: a second visit — still to the receipt itself — renders the frozen snapshot rather
    // than re-running completion. Checked *before* visiting any other page: `RetiredSessionMiddleware`
    // deliberately excludes the receipt step from clearing the session cookie (`[4.18]`'s "delayed"
    // teardown), so the first non-receipt page visited after completion is what actually retires it
    // — visiting `/checkout/` first would end the session before this assertion runs.
    const receiptAgain = await agent.get('/thank-you/');
    expect(receiptAgain.status).toBe(200);
    expect(receiptAgain.text).toContain(receipt.text.match(/Order #(\S+)/)?.[0] ?? 'Order #');

    // The cart was cleared on placement — checkout's own `cart_not_empty` precondition now fails,
    // and the funnel guard redirects away rather than rendering a checkout page for nothing. This
    // is also the first non-receipt page after completion, so it's what triggers `[4.18]`'s delayed
    // session teardown (`RetiredSessionMiddleware`) — checked last for that reason.
    const checkoutAfter = await agent.get('/checkout/').redirects(0);
    expect(checkoutAfter.status).toBeGreaterThanOrEqual(300);
    expect(checkoutAfter.status).toBeLessThan(400);
    expect(checkoutAfter.headers.location).not.toBe('/checkout/');
  });
});
