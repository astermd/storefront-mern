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
const BLOCKED_PRODUCT_SLUG = 'test-blocked-item';

/** An adapter whose next `place()` outcome is set per-test, so one harness can drive every branch of `CheckoutService.submit()` past validation. */
class ScriptedAdapter implements PaymentAdapter {
  next: PlacementOutcome = PlacementOutcome.declined(null, 'not configured', 'unset');
  calls = 0;

  capabilities(): AdapterCapabilities {
    return new AdapterCapabilities('test-stub', false, SCOPE_LINE_ITEM, STRATEGY_TOKENIZATION, SURFACE_THEME_FIELDS, [], [], 'Test stub adapter.', false, false, false, false, []);
  }

  async place(_order: OrderEnvelope, _credential: PaymentCredential): Promise<PlacementOutcome> {
    this.calls += 1;
    return this.next;
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
 * Exercises the branches of `CheckoutService.submit()` that `checkout-to-receipt.e2e-spec.ts`'s one
 * happy path doesn't reach: validation, consent, geo blocking, a provider decline/pending-action,
 * and the rate limiter — all against a real migrated database, the same way that spec does, since
 * `DatabaseRateLimiter`/`CheckoutAttemptRepository` are real collaborators, not stubs.
 */
describe('Checkout submission — decline/validation/geo/rate-limit branches', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let dbDir: string;
  let adapter: ScriptedAdapter;

  beforeAll(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'mern-test-checkout-submit-db-'));
    const url = `file:${join(dbDir, 'test.sqlite3')}`;

    execFileSync('npx', ['prisma', 'db', 'push', '--url', url, '--accept-data-loss'], { cwd: process.cwd(), stdio: 'ignore' });
    prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

    const catalog = new FakeCatalogProvider([
      {
        slug: PRODUCT_SLUG,
        name: 'Test OTC Item',
        kind: 'otc',
        price_cents: 2500,
        variants: [{ id: 'default', name: 'Standard', price_cents: 2500, provider: { offer_id: 'offer-1', product_id: 'product-1' } }],
      },
      {
        slug: BLOCKED_PRODUCT_SLUG,
        name: 'Test Blocked Item',
        kind: 'otc',
        price_cents: 1500,
        geo_blocks: ['NY'],
        variants: [{ id: 'default', name: 'Standard', price_cents: 1500, provider: { offer_id: 'offer-2', product_id: 'product-2' } }],
      },
    ]);

    adapter = new ScriptedAdapter();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(prisma)
      .overrideProvider(CatalogProvider)
      .useValue(catalog)
      .overrideProvider(PAYMENT_ADAPTER)
      .useValue(adapter)
      .overrideProvider(SESSION_GATEWAY)
      .useValue(new FakeSessionGateway())
      .compile();

    app = await createTestApp(moduleRef);
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

  const VALID_BUYER = {
    first_name: 'Jane',
    last_name: 'Doe',
    email: 'jane@example.com',
    phone: '5551234567',
    address_line: '123 Main St',
    city: 'Springfield',
    territory: 'CA',
    postal_code: '90001',
    card_number: '4111111111111111',
    card_expiry: '12/30',
    card_cvc: '123',
    consents: { terms: '1' },
  };

  async function freshAgentWithProduct(slug: string): Promise<{ agent: ReturnType<typeof request.agent>; csrf: string }> {
    const agent = request.agent(app.getHttpServer());
    const productPage = await agent.get(`/products/${slug}/`);
    const csrf = extractCsrf(productPage.text);
    const added = await agent.post('/cart/add').type('form').redirects(0).send({ _csrf: csrf, slug, quantity: 1 });
    expect(added.status).toBe(303);
    const checkoutPage = await agent.get('/checkout/');
    return { agent, csrf: extractCsrf(checkoutPage.text) };
  }

  it('re-renders at 200 with field errors, cart intact, when the buyer details are invalid — never calling the adapter', async () => {
    const { agent, csrf } = await freshAgentWithProduct(PRODUCT_SLUG);
    const callsBefore = adapter.calls;

    const res = await agent
      .post('/checkout')
      .type('form')
      .redirects(0)
      .send({ ...VALID_BUYER, _csrf: csrf, email: 'not-an-email' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('email');
    expect(adapter.calls).toBe(callsBefore);

    const checkoutAfter = await agent.get('/checkout/');
    expect(checkoutAfter.status).toBe(200);
    expect(checkoutAfter.text).toContain('Test OTC Item');
  });

  it('refuses without calling the adapter when the blocking consent is missing', async () => {
    const { agent, csrf } = await freshAgentWithProduct(PRODUCT_SLUG);
    const callsBefore = adapter.calls;

    const res = await agent
      .post('/checkout')
      .type('form')
      .redirects(0)
      .send({ ...VALID_BUYER, _csrf: csrf, consents: {} });

    expect(res.status).toBe(200);
    expect(res.text).toContain('agree');
    expect(adapter.calls).toBe(callsBefore);
  });

  it('declines with the geo-blocked notice, cart intact, when the submitted territory blocks a line', async () => {
    const { agent, csrf } = await freshAgentWithProduct(BLOCKED_PRODUCT_SLUG);
    const callsBefore = adapter.calls;

    const res = await agent
      .post('/checkout')
      .type('form')
      .redirects(0)
      .send({ ...VALID_BUYER, _csrf: csrf, territory: 'NY' });

    expect(res.status).toBe(200);
    expect(res.text.toLowerCase()).toContain('not available');
    expect(adapter.calls).toBe(callsBefore); // geo gate runs before the provider is ever reached

    const checkoutAfter = await agent.get('/checkout/');
    expect(checkoutAfter.text).toContain('Test Blocked Item');
  });

  it('re-renders the provider\'s own decline reason at 200, with the cart still intact', async () => {
    const { agent, csrf } = await freshAgentWithProduct(PRODUCT_SLUG);
    adapter.next = PlacementOutcome.declined(null, 'Your card was declined by your bank.', 'card_declined');

    const res = await agent.post('/checkout').type('form').redirects(0).send({ ...VALID_BUYER, _csrf: csrf });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Your card was declined by your bank.');

    const checkoutAfter = await agent.get('/checkout/').redirects(0);
    expect(checkoutAfter.status).toBe(200);
    expect(checkoutAfter.text).toContain('Test OTC Item');
  });

  it('re-renders with the pending-action notice, carrying the provider reference, on a 3DS-style challenge', async () => {
    const { agent, csrf } = await freshAgentWithProduct(PRODUCT_SLUG);
    adapter.next = PlacementOutcome.pendingAction('pending-ref-1', 'https://provider.example/3ds');

    const res = await agent.post('/checkout').type('form').redirects(0).send({ ...VALID_BUYER, _csrf: csrf });

    expect(res.status).toBe(200);
    expect(res.text).toContain('pending-ref-1');
  });

  it('answers 429 with the rate-limited notice once the flood guard trips, without ever reaching the provider again', async () => {
    const { agent, csrf: firstCsrf } = await freshAgentWithProduct(PRODUCT_SLUG);
    adapter.next = PlacementOutcome.declined(null, 'Declined for the flood test.', 'card_declined');

    let csrf = firstCsrf;
    let lastStatus = 200;
    const callsBefore = adapter.calls;

    // The rate limiter's identity is the client address (`RequestContext`/`config/payment.ts`'s
    // `checkout.submit` bucket), not the session — every test in this file shares one address under
    // supertest, so this test needs its own `X-Forwarded-For` to get an isolated bucket rather than
    // inheriting whatever budget the tests above it already spent.
    async function submit(body: Record<string, unknown>) {
      return agent.post('/checkout').type('form').redirects(0).set('X-Forwarded-For', '203.0.113.77').send(body);
    }

    // The limit is 8 per 300s (config/payment.ts) — the 9th attempt in this window must be refused.
    for (let attempt = 0; attempt < 9; attempt++) {
      const res = await submit({ ...VALID_BUYER, _csrf: csrf });
      lastStatus = res.status;
      if (res.status !== 429) csrf = extractCsrf(res.text);
    }

    expect(lastStatus).toBe(429);
    expect(adapter.calls).toBe(callsBefore + 8);
  });
});
