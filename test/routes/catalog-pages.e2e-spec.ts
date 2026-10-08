import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { productsGenerated } from '../../config/products.generated.example';
import { CatalogProvider } from '../../src/catalog/catalog-provider';
import { FakeCatalogProvider } from '../support/fake-catalog-provider';
import { createTestApp } from '../support/test-app';

/**
 * Proves Phase 5's browsable-pages "done" bar: home renders featured products with correctly
 * formatted prices, treatments lists every rx/otc product and its categories, product detail
 * renders a known slug and 404s an unknown one — the full pipeline (middleware, catalog, EJS)
 * working together for the first time on real (non-Null-journey) logic.
 *
 * Overrides `CatalogProvider` with the committed example catalog (`products.generated.example.ts`)
 * rather than letting the app boot against whatever `config/products.generated.ts` currently holds
 * — that file is live, mutable data a real `theme:sync --apply` overwrites (as it did mid-session,
 * once against a real channel), and this test's assertions (specific slugs, variant names, bundle
 * behaviour) are about the example catalog's shape, not about whatever the last sync happened to
 * fetch.
 */
describe('Catalog pages (Phase 5)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const catalog = new FakeCatalogProvider(Object.values(productsGenerated.products), productsGenerated.channel);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CatalogProvider)
      .useValue(catalog)
      .compile();
    app = await createTestApp(moduleRef);
  });

  afterAll(async () => {
    await app.close();
  });

  it('renders the home page with featured products and formatted prices', async () => {
    const res = await request(app.getHttpServer()).get('/');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Semaglutide');
    expect(res.text).toContain('$299.00/mo');
  });

  it('renders the treatments listing with every rx/otc product and its categories', async () => {
    const res = await request(app.getHttpServer()).get('/treatments/');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Semaglutide');
    expect(res.text).toContain('Vitamin D3');
    // free-addon products (the syringe kits) must never appear on a listing surface (`[6.1]`).
    expect(res.text).not.toContain('Syringe Kit');
    expect(res.text).toContain('Weight Loss');
  });

  it('renders a known product detail page with its variants', async () => {
    const res = await request(app.getHttpServer()).get('/products/aa1113-sildenafil/');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Sildenafil');
    expect(res.text).toContain('25mg');
    expect(res.text).toContain('50mg');
    expect(res.text).toContain('100mg');
  });

  it('404s a product detail page for an unknown slug', async () => {
    const res = await request(app.getHttpServer()).get('/products/does-not-exist/');

    expect(res.status).toBe(404);
    expect(res.text).toContain('Page not found');
  });
});
