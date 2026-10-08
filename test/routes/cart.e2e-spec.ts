import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { productsGenerated } from '../../config/products.generated.example';
import { CatalogProvider } from '../../src/catalog/catalog-provider';
import { EventRepository } from '../../src/repository/event-repository';
import { FakeCatalogProvider } from '../support/fake-catalog-provider';
import { createTestApp } from '../support/test-app';

/**
 * Proves Phase 5's cart-mutation "done" bar over the real, fully-wired app: adding a product
 * attaches its mandatory bundle (`[7.5]`), routes onward per the funnel's routing decision, the
 * drawer reflects the change on the next request, and removing it empties the cart again.
 *
 * Overrides `CatalogProvider` with the committed example catalog (`products.generated.example.ts`)
 * rather than the live, mutable `config/products.generated.ts` — this test's assertions depend on
 * `aa1111-semaglutide`'s specific shape (a `teleform_id`, a mandatory zero-priced bundle) and
 * `aa1115-vitamin-d3` existing at all, neither of which survives a real `theme:sync --apply`.
 *
 * `EventRepository` is overridden with a no-op fake — `CartMirror`'s audit trail write is a real,
 * separate concern (Prisma-backed) this test isn't exercising, and Jest's default in-memory test
 * database (see `test/jest.setup.ts`) has no migrated schema for it to write into. `CART_GATEWAY`
 * stays the real `NullCartGateway` binding, matching production.
 */
describe('Cart mutations (Phase 5)', () => {
  let app: NestExpressApplication;
  let agent: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    const catalog = new FakeCatalogProvider(Object.values(productsGenerated.products), productsGenerated.channel);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CatalogProvider)
      .useValue(catalog)
      .overrideProvider(EventRepository)
      .useValue({ append: async () => undefined, hasName: async () => false, namesFor: async () => [] })
      .compile();

    app = await createTestApp(moduleRef);
    agent = request.agent(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  function extractCsrf(html: string): string {
    const match = html.match(/name="_csrf" value="([^"]+)"/);
    if (!match) throw new Error('No CSRF token found in response body');
    return match[1];
  }

  it('adds a product, attaches its bundle, and routes onward per the funnel decision', async () => {
    const productPage = await agent.get('/products/aa1111-semaglutide/');
    const csrf = extractCsrf(productPage.text);

    const res = await agent
      .post('/cart/add')
      .type('form')
      .redirects(0)
      .send({
        _csrf: csrf,
        slug: 'aa1111-semaglutide',
        variant_id: 'semaglutide-monthly',
        return_to: '/products/aa1111-semaglutide/',
        intent: 'assessment',
      });

    expect(res.status).toBe(303);
    // Semaglutide declares a teleform_id with no journey answers yet, so the routing decision
    // sends the buyer to the medical intake step rather than straight to checkout.
    expect(res.headers.location).toBe('/intake/medical/');

    const drawer = await agent.get('/treatments/');
    expect(drawer.text).toMatch(/Open cart, 1 item/);
    expect(drawer.text).toContain('Semaglutide');
    // The mandatory bundle attached automatically (`[7.5]`), priced at zero (`[7.14a]`).
    expect(drawer.text).toContain('Syringe Kit');
    expect(drawer.text).toContain('$0.00');
  });

  it('flashes a notice and rejects an unknown product without mutating the cart', async () => {
    const page = await agent.get('/treatments/');
    const csrf = extractCsrf(page.text);

    const res = await agent
      .post('/cart/add')
      .type('form')
      .redirects(0)
      .send({ _csrf: csrf, slug: 'no-such-product', return_to: '/treatments/' });

    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/treatments/');

    const after = await agent.get('/treatments/');
    expect(after.text).toContain('That product is not available.');
  });

  it('removes a product and its bundle together, emptying the cart', async () => {
    const page = await agent.get('/treatments/');
    const csrf = extractCsrf(page.text);

    const res = await agent
      .post('/cart/remove')
      .type('form')
      .redirects(0)
      .send({ _csrf: csrf, slug: 'aa1111-semaglutide', return_to: '/treatments/' });

    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/treatments/');

    const after = await agent.get('/treatments/');
    expect(after.text).toMatch(/Open cart, 0 items/);
    expect(after.text).not.toContain('Syringe Kit');
  });

  it('flashes "Enter a valid quantity." for a non-numeric quantity, without ever reaching CartRules', async () => {
    const productPage = await agent.get('/products/aa1115-vitamin-d3/');
    let csrf = extractCsrf(productPage.text);

    await agent.post('/cart/add').type('form').redirects(0).send({
      _csrf: csrf,
      slug: 'aa1115-vitamin-d3',
      return_to: '/products/aa1115-vitamin-d3/',
      intent: 'assessment',
    });

    const cartPage = await agent.get('/treatments/');
    csrf = extractCsrf(cartPage.text);

    const res = await agent
      .post('/cart/quantity')
      .type('form')
      .redirects(0)
      .send({ _csrf: csrf, slug: 'aa1115-vitamin-d3', quantity: 'not-a-number', return_to: '/treatments/' });

    expect(res.status).toBe(303);

    const after = await agent.get('/treatments/');
    expect(after.text).toContain('Enter a valid quantity.');
    // Quantity untouched — the flash happens before CartRules.setQuantity() is ever called.
    expect(after.text).toMatch(/Open cart, 1 item/);
  });
});
