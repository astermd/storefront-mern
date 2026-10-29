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

  it('forces both EMR verification switches and address autofill off under NODE_ENV=test', () => {
    const config = loadAppConfig({ NODE_ENV: 'test', EMR_VERIFICATION: 'true', EMR_VERIFY_EMAIL: 'true', EMR_VERIFY_ADDRESS: 'true' });
    expect(config.features.emrVerifyEmail).toBe(false);
    expect(config.features.emrVerifyAddress).toBe(false);
    expect(config.features.addressAutofill).toBe(false);
  });

  it('leaves session.analytics true outside of test, and address autofill on', () => {
    const production = loadAppConfig({ NODE_ENV: 'production' });
    expect(production.session.analytics).toBe(true);
    expect(production.features.addressAutofill).toBe(true);
  });

  it('EMR_VERIFY_EMAIL and EMR_VERIFY_ADDRESS switch each check on its own', () => {
    const emailOnly = loadAppConfig({ NODE_ENV: 'production', EMR_VERIFY_EMAIL: 'true' });
    expect(emailOnly.features.emrVerifyEmail).toBe(true);
    expect(emailOnly.features.emrVerifyAddress).toBe(false);

    const addressOnly = loadAppConfig({ NODE_ENV: 'production', EMR_VERIFY_ADDRESS: 'true' });
    expect(addressOnly.features.emrVerifyEmail).toBe(false);
    expect(addressOnly.features.emrVerifyAddress).toBe(true);
  });

  it('the older EMR_VERIFICATION still sets both when neither is given, and loses to an explicit one', () => {
    const legacy = loadAppConfig({ NODE_ENV: 'production', EMR_VERIFICATION: 'true' });
    expect(legacy.features.emrVerifyEmail).toBe(true);
    expect(legacy.features.emrVerifyAddress).toBe(true);

    const mixed = loadAppConfig({ NODE_ENV: 'production', EMR_VERIFICATION: 'true', EMR_VERIFY_ADDRESS: 'false' });
    expect(mixed.features.emrVerifyEmail).toBe(true);
    expect(mixed.features.emrVerifyAddress).toBe(false);

    const off = loadAppConfig({ NODE_ENV: 'production' });
    expect(off.features.emrVerifyEmail).toBe(false);
    expect(off.features.emrVerifyAddress).toBe(false);
  });

  it('also discourages indexing in every non-production environment, not only test', () => {
    expect(loadAppConfig({ NODE_ENV: 'test' }).seo.discourageIndexing).toBe(true);
    expect(loadAppConfig({ NODE_ENV: 'development' }).seo.discourageIndexing).toBe(true);
    expect(loadAppConfig({ NODE_ENV: 'production' }).seo.discourageIndexing).toBe(false);
  });
});
