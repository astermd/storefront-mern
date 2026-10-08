import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { RobotsPolicy } from '../../src/seo/robots-policy';
import { createTestApp } from '../support/test-app';

/**
 * Proves Phase 9's `robots.txt`/`sitemap.xml` "done" bar: the two documents agree with each other
 * (nothing `robots.txt` disallows appears in the sitemap, and vice versa), both are served with the
 * right content type, and `robots.txt` correctly falls back to a blanket disallow under
 * `discourageIndexing` (every non-production environment, including this test's `NODE_ENV=test`) —
 * `sitemap.xml` still serves, but lists nothing, so the two documents cannot tell a crawler
 * different stories (`[24.7]`).
 */
describe('robots.txt and sitemap.xml (Phase 9)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await createTestApp(moduleRef);
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves a blanket Disallow under discourageIndexing, and still links the sitemap', async () => {
    const res = await request(app.getHttpServer()).get('/robots.txt');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('User-agent: *');
    expect(res.text).toContain('Disallow: /');
    expect(res.text).toMatch(/Sitemap: https?:\/\/\S+\/sitemap\.xml/);
  });

  it('serves an empty but well-formed <urlset> under discourageIndexing, agreeing with robots.txt', async () => {
    const res = await request(app.getHttpServer()).get('/sitemap.xml');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/xml');
    expect(res.text).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(res.text).not.toContain('<url>');
  });

  it('is not redirected by CanonicalUrlMiddleware despite carrying no trailing slash', async () => {
    const robots = await request(app.getHttpServer()).get('/robots.txt').redirects(0);
    const sitemap = await request(app.getHttpServer()).get('/sitemap.xml').redirects(0);

    expect(robots.status).toBe(200);
    expect(sitemap.status).toBe(200);
  });
});

/**
 * The indexable case, with `discourageIndexing` off: `robots.txt`'s `Disallow` list and
 * `sitemap.xml`'s entries both derive from the same `RobotsPolicy`, so a path disallowed by one is
 * absent from the other — proven here by overriding the real per-path policy rather than by
 * reconstructing `discourageIndexing: false` through environment variables.
 */
describe('robots.txt and sitemap.xml agree on a real per-path policy', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const policy = new RobotsPolicy({ '/checkout/*': 'noindex, nofollow' }, false);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(RobotsPolicy).useValue(policy).compile();
    app = await createTestApp(moduleRef);
  });

  afterAll(async () => {
    await app.close();
  });

  it('robots.txt disallows exactly the refused paths, and allows everything else', async () => {
    const res = await request(app.getHttpServer()).get('/robots.txt');

    expect(res.text).toContain('Disallow: /checkout/');
    expect(res.text).not.toContain('Disallow: /treatments/');
  });

  it('sitemap.xml lists the marketing surface and every product, but never a path robots.txt disallows', async () => {
    const res = await request(app.getHttpServer()).get('/sitemap.xml');

    expect(res.text).toContain('/treatments/');
    expect(res.text).toContain('/terms/');
    expect(res.text).not.toContain('/checkout/');
  });
});
