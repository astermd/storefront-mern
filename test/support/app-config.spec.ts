import { loadAppConfig } from '../../config/app';

/**
 * Phase 11's own "done" bar item: `NODE_ENV=test` must force every network-touching flag off, not
 * merely "usually" — this is the one guarantee the whole test suite's "no test reaches a real EMR/
 * payment provider" claim rests on (see `core.module.ts`'s `SESSION_GATEWAY`/`CART_GATEWAY`/
 * `EMR_VERIFICATION_GATEWAY`/`TELEFORM_GATEWAY`/etc. factories, all gated on these same two flags).
 * Asserted directly against the pure `loadAppConfig()` function rather than incidentally through an
 * e2e test that happens to also exercise it.
 */
describe('loadAppConfig — NODE_ENV=test forces every network-touching flag off', () => {
  it('forces session.analytics false under NODE_ENV=test, even if an operator tries to force it on', () => {
    const config = loadAppConfig({ NODE_ENV: 'test' });
    expect(config.session.analytics).toBe(false);
  });

  it('forces features.emrVerification false under NODE_ENV=test, even with EMR_VERIFICATION=true set', () => {
    const config = loadAppConfig({ NODE_ENV: 'test', EMR_VERIFICATION: 'true' });
    expect(config.features.emrVerification).toBe(false);
  });

  it('leaves session.analytics true, and emrVerification following its own env var, outside of test', () => {
    const production = loadAppConfig({ NODE_ENV: 'production', EMR_VERIFICATION: 'true' });
    expect(production.session.analytics).toBe(true);
    expect(production.features.emrVerification).toBe(true);

    const productionWithoutFlag = loadAppConfig({ NODE_ENV: 'production' });
    expect(productionWithoutFlag.features.emrVerification).toBe(false);
  });

  it('also discourages indexing in every non-production environment, not only test', () => {
    expect(loadAppConfig({ NODE_ENV: 'test' }).seo.discourageIndexing).toBe(true);
    expect(loadAppConfig({ NODE_ENV: 'development' }).seo.discourageIndexing).toBe(true);
    expect(loadAppConfig({ NODE_ENV: 'production' }).seo.discourageIndexing).toBe(false);
  });
});
