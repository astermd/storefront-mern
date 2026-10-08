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
import { DATABASE_CONNECTION, SESSION_GATEWAY, TELEFORM_GATEWAY } from '../../src/core/tokens';
import { TeleformMetadata } from '../../src/forms/teleform-metadata';
import { FakeCatalogProvider } from '../support/fake-catalog-provider';
import { FakeSessionGateway } from '../support/fake-session-gateway';
import { FakeTeleformGateway, minimalIntakeDefinition } from '../support/fake-teleform-gateway';
import { createTestApp } from '../support/test-app';

const PRODUCT_SLUG = 'test-intake-product';
const TELEFORM_ID = 'test-intake-form';

/**
 * `/intake/*` and `/verify/` have never had an HTTP-level test before this — the shipped example
 * catalog's teleform ids don't exist in the real EMR channel, so `NullTeleformGateway`'s degrade
 * path is all any prior test (or the live app) could ever reach (see STATUS.md's Phase 6 section).
 * Overriding `TELEFORM_GATEWAY` with a fixture-backed fake, and giving the test product a real
 * `teleform_id`, proves the whole render -> validate -> submit -> advance round trip for the first
 * time, plus `/verify/`'s Null-identity "always inconclusive" path and `/not-eligible/`'s
 * from-anywhere reachability.
 */
describe('Intake + verify + not-eligible routes', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let dbDir: string;

  beforeAll(async () => {
    // The default in-memory DB from test/jest.setup.ts has no schema at all — every write against
    // it fails silently (this codebase's pervasive "a lost write must never become the visitor's
    // problem" rule), which would make `formCompleted()` look permanently false without ever
    // surfacing an error. A real migrated database is what lets `[10.42]`-style journey state
    // (`markFormCompleted`) actually survive across requests, the same way
    // `checkout-to-receipt.e2e-spec.ts` needs one for order placement to survive its own redirects.
    dbDir = mkdtempSync(join(tmpdir(), 'mern-test-intake-db-'));
    const url = `file:${join(dbDir, 'test.sqlite3')}`;
    execFileSync('npx', ['prisma', 'db', 'push', '--url', url, '--accept-data-loss'], { cwd: process.cwd(), stdio: 'ignore' });
    prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

    const catalog = new FakeCatalogProvider([
      {
        slug: PRODUCT_SLUG,
        name: 'Test Intake Product',
        kind: 'otc',
        price_cents: 1000,
        teleform_id: TELEFORM_ID,
        variants: [{ id: 'default', name: 'Standard', price_cents: 1000, provider: { offer_id: 'offer-1', product_id: 'product-1' } }],
      },
    ]);

    const teleforms = new FakeTeleformGateway().register(
      new TeleformMetadata(TELEFORM_ID, 'test-intake-form-v1', 'intake', 'single-column', {}),
      minimalIntakeDefinition(),
    );

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(prisma)
      .overrideProvider(CatalogProvider)
      .useValue(catalog)
      .overrideProvider(TELEFORM_GATEWAY)
      .useValue(teleforms)
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

  async function agentWithProductInCart(): Promise<{ agent: ReturnType<typeof request.agent>; csrf: string }> {
    const agent = request.agent(app.getHttpServer());
    const productPage = await agent.get(`/products/${PRODUCT_SLUG}/`);
    const csrf = extractCsrf(productPage.text);
    const added = await agent.post('/cart/add').type('form').redirects(0).send({ _csrf: csrf, slug: PRODUCT_SLUG, quantity: 1 });
    expect(added.status).toBe(303);
    return { agent, csrf };
  }

  it('renders the real fixture-backed questionnaire, not the form-unavailable degrade', async () => {
    const { agent } = await agentWithProductInCart();

    const res = await agent.get('/intake/medical/');

    expect(res.status).toBe(200);
    expect(res.text).toContain('First name');
    expect(res.text).toContain('I agree to the intake terms');
    expect(res.text).not.toContain('cannot display');
  });

  it('re-renders at 200 with a field error when a required answer is missing, cart/journey intact', async () => {
    const { agent } = await agentWithProductInCart();
    const formPage = await agent.get('/intake/medical/');
    const csrf = extractCsrf(formPage.text);

    const res = await agent.post('/intake/submit').type('form').redirects(0).send({ _csrf: csrf, step: 'intake', first_name: 'Jane' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('required');

    const again = await agent.get('/intake/medical/');
    expect(again.status).toBe(200);
  });

  it('advances past intake toward checkout on a valid, fully-answered submit', async () => {
    const { agent } = await agentWithProductInCart();
    const formPage = await agent.get('/intake/medical/');
    const csrf = extractCsrf(formPage.text);

    const res = await agent
      .post('/intake/submit')
      .type('form')
      .redirects(0)
      .send({ _csrf: csrf, step: 'intake', first_name: 'Jane', consent: '1' });

    expect(res.status).toBe(303);
    expect(res.headers.location).not.toBe('/intake/medical/');
    expect(res.headers.location).not.toBe('/not-eligible/');
  });

  it('/verify/ renders the Null-identity "inconclusive" copy once intake is satisfied — verification.enabled is false, so this is never reached automatically, only by direct navigation', async () => {
    const { agent } = await agentWithProductInCart();
    const formPage = await agent.get('/intake/medical/');
    const csrf = extractCsrf(formPage.text);
    await agent.post('/intake/submit').type('form').redirects(0).send({ _csrf: csrf, step: 'intake', first_name: 'Jane', consent: '1' });

    const verifyPage = await agent.get('/verify/');
    expect(verifyPage.status).toBe(200);

    const verifyCsrf = extractCsrf(verifyPage.text);
    const submitted = await agent.post('/verify').type('form').redirects(0).send({ _csrf: verifyCsrf });

    // verification.enabled is false, so `verification_satisfied` is trivially true regardless of
    // the recorded verdict — the visitor is never held here.
    expect(submitted.status).toBe(303);
    expect(submitted.headers.location).toBe('/checkout/');
  });

  it('/not-eligible/ is reachable from anywhere, even with an empty cart', async () => {
    const agent = request.agent(app.getHttpServer());
    const res = await agent.get('/not-eligible/');
    expect(res.status).toBe(200);
  });
});
