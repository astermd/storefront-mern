import { ConfigValidateCommand } from '../../src/console/config-validate.command';
import { CatalogProduct } from '../../src/domain/product-catalog';
import { AdapterCapabilities, SCOPE_LINE_ITEM, STRATEGY_TOKENIZATION, SURFACE_PROVIDER_HOSTED } from '../../src/payment/adapter-capabilities';

/** The settlement and subscription-plan checks in `ConfigValidateCommand.validateSettlement()`. */
describe('config:validate settlement', () => {
  const plan = (id: string, settlement?: string) => ({ id, name: id, first_payment_cents: 1000, ...(settlement === undefined ? {} : { settlement }) });

  function run(products: CatalogProduct[], opts: { canHold?: boolean; provider?: string; defaultMode?: 'capture' | 'authorize'; ccMode?: string } = {}) {
    const config = {
      app: { debug: { wireLog: false }, portal: { url: 'https://portal.example.com' } },
      abandonment: { idleSeconds: 1, lookbackSeconds: 1, limit: 1, marketingConsentKey: 'marketing' },
      consent: { consents: [{ key: 'marketing' }] },
      verification: { enabled: false },
      payment: { settlement: opts.defaultMode ?? 'capture', checkoutChamp: { authorizeMode: opts.ccMode ?? 'qa' } },
    };
    const capabilities = new AdapterCapabilities(opts.provider ?? 'stripe', true, SCOPE_LINE_ITEM, STRATEGY_TOKENIZATION, SURFACE_PROVIDER_HOSTED, [], [], '', false, false, false, opts.canHold ?? true, []);
    const command = new ConfigValidateCommand(config as never, { products: () => products } as never, { capabilities: () => capabilities } as never);

    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const exitCode = process.exitCode;
    void command.run();
    const out = { warnings: log.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('warning:')), errors: error.mock.calls.map((c) => String(c[0])), failed: process.exitCode === 2 };
    process.exitCode = exitCode;
    log.mockRestore();
    error.mockRestore();
    return out;
  }

  const product = (slug: string, kind: string, plans: ReturnType<typeof plan>[], extra: Partial<CatalogProduct> = {}): CatalogProduct => ({
    slug,
    name: slug,
    kind,
    variants: [{ id: 'v1', name: 'v1', price_cents: 1000, ...(plans.length ? { plan: plans[0], plans } : {}) }],
    ...extra,
  });

  it('passes a catalog whose plans take the money', () => {
    expect(run([product('nad', 'rx', [plan('a', 'capture'), plan('b')])])).toMatchObject({ errors: [], warnings: [], failed: false });
  });

  it('refuses a plan whose settlement is not a mode', () => {
    const out = run([product('nad', 'rx', [plan('a', 'later')])]);
    expect(out.failed).toBe(true);
    expect(out.errors[0]).toContain('plan a, whose settlement is "later"');
  });

  it('refuses a holding plan on a provider that cannot hold', () => {
    const out = run([product('nad', 'rx', [plan('a', 'authorize')])], { canHold: false, provider: 'vrio' });
    expect(out.errors[0]).toContain('vrio adapter does not support authorize-and-capture');
  });

  it('warns when a plan holds the first payment of a non-prescription', () => {
    const out = run([product('minox', 'otc', [plan('a', 'authorize')])]);
    expect(out.failed).toBe(false);
    expect(out.warnings[0]).toContain('plan a holds the first payment of product minox, which is not a prescription');
  });

  it('warns that a product settlement key does not reach its plan variants, and refuses an unreadable one', () => {
    expect(run([product('nad', 'rx', [plan('a', 'capture')], { settlement: 'authorize' })]).warnings[0]).toContain('product nad sets settlement, which does not apply');
    expect(run([product('x', 'otc', [], { settlement: 'hold' as never })]).errors[0]).toContain('product x sets settlement to "hold"');
  });

  it("checks CheckoutChamp's authorize mode only when CheckoutChamp is the provider", () => {
    expect(run([], { provider: 'checkout_champ', ccMode: 'maybe' }).errors[0]).toContain('authorizeMode is "maybe"');
    expect(run([], { provider: 'stripe', ccMode: 'maybe' }).errors).toEqual([]);
  });
});
