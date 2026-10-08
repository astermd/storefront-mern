import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { createTestApp } from '../support/test-app';

/**
 * Proves Phase 9's legal-pages "done" bar: all three render with their placeholder-copy content,
 * and — since none of them pass an explicit `noindex` — the rendered `<meta name="robots">` tag
 * agrees with the `X-Robots-Tag` header `SeoMiddleware` already sets on every response (`[24.2]`'s
 * "enforced twice" requirement), both showing `noindex` under `NODE_ENV=test`'s `discourageIndexing`
 * master switch.
 */
describe('Legal pages (Phase 9)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await createTestApp(moduleRef);
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['/terms/', 'Terms of Service'],
    ['/privacy/', 'Privacy Policy'],
    ['/telehealth-consent/', 'Telehealth Consent'],
  ])('renders %s with its placeholder copy, and agrees header vs. meta tag on noindex', async (path, heading) => {
    const res = await request(app.getHttpServer()).get(path);

    expect(res.status).toBe(200);
    expect(res.text).toContain(heading);
    expect(res.text).toContain('This page is placeholder text and is not legal advice.');
    expect(res.text).toContain('config/consent.ts');

    // Header and meta tag must agree — both come from the same `RobotsPolicy` resolution under
    // `NODE_ENV=test`'s `discourageIndexing: true`.
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(res.text).toContain('<meta name="robots" content="noindex, nofollow" />');
  });

  /**
   * The gap `head.ejs`'s Phase 9 fallback closes: the home page passes no `noindex` opinion of its
   * own (by design — it uses sitewide SEO defaults), so before the fallback its `X-Robots-Tag`
   * header said `noindex` under test while its meta tag said nothing at all.
   */
  it('the home page (no explicit noindex) also agrees header vs. meta tag under NODE_ENV=test', async () => {
    const res = await request(app.getHttpServer()).get('/');

    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(res.text).toContain('<meta name="robots" content="noindex, nofollow" />');
  });
});
