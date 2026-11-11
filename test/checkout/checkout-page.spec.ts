import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ejs from 'ejs';
import { AdapterCapabilities, SCOPE_ORDER_LEVEL, SCOPE_LINE_ITEM, STRATEGY_TOKENIZATION, SURFACE_PROVIDER_HOSTED, SURFACE_THEME_FIELDS } from '../../src/payment/adapter-capabilities';
import { CheckoutViewModel } from '../../src/checkout/checkout-view-model';
import { ConsentDefinition } from '../../src/checkout/consent-definition';
import { Promotion } from '../../src/checkout/promotion';
import { Totals } from '../../src/checkout/totals';

/**
 * Renders `views/pages/checkout.ejs` against a realistic `CheckoutViewModel` — the same real
 * classes `CheckoutService`/`CheckoutController` assemble, not hand-typed template locals — to
 * prove the template is runtime-safe: field errors, a promotion, order bumps, a plan selector, and
 * a Null-adapter-shaped `AdapterCapabilities` (theme-rendered card fields, no authorize/capture).
 */
describe('checkout page renders', () => {
  const viewsDir = join(process.cwd(), 'views');

  function render(locals: Record<string, unknown>): string {
    return ejs.render(readFileSync(join(viewsDir, 'pages/checkout.ejs'), 'utf8'), locals, {
      views: [viewsDir],
      filename: join(viewsDir, 'pages/checkout.ejs'),
    });
  }

  const baseGlobals = {
    csrf_token: 'csrf-token',
    url: (p: string) => p,
    asset: (n: string) => '/assets/build/' + n,
    money: (c: number) => '$' + (c / 100).toFixed(2),
    site: { name: 'AsterMD', url: 'http://localhost' },
    app_env: 'test',
    maps_api_key: null,
    portal_url: null,
    footer_products: [],
    current_path: '/checkout/',
    cart: { count: 1, subtotal_cents: 5000, notice: null, lines: [], actions: { assessment: null, checkout: null, terminal: null } },
  };

  const capabilities = new AdapterCapabilities('none', false, SCOPE_LINE_ITEM, STRATEGY_TOKENIZATION, SURFACE_THEME_FIELDS, [], [], 'No provider configured.', false, false, false, false, []);
  const promotionCapableCapabilities = new AdapterCapabilities('stub', true, SCOPE_LINE_ITEM, STRATEGY_TOKENIZATION, SURFACE_THEME_FIELDS, [], [], 'Stub provider.', false, false, false, false, []);

  const semaglutidePlan = { slug: 'semaglutide', name: 'Semaglutide', chosen: 'plan-3mo', options: [{ id: 'plan-1mo', name: '1 Month Plan', price_cents: 5000 }, { id: 'plan-3mo', name: '3 Month Plan', price_cents: 15000 }] };

  it('renders the happy path with a plan, a bump, a promotion, and consents', () => {
    const totals = Totals.of(15000, new Promotion('SAVE10', 1000));
    const checkout = new CheckoutViewModel(
      { first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com', phone: '5551234567', address_line: '123 Main St', city: 'Springfield', territory: 'NY', postal_code: '10001' },
      {},
      'Your order changed, so your discount has been recalculated.',
      totals,
      [{ slug: 'semaglutide', name: 'Semaglutide', quantity: 1, unit_price_cents: 15000, line_total_cents: 15000, variant_name: '3 Month Plan', image: null, is_free: false, is_child: false }],
      [{ key: 'sleep-mask', slug: 'sleep-mask', headline: 'Add a Sleep Mask', body: 'Free with your order.', name: 'Sleep Mask', price_cents: 0, catalog_price_cents: 500, discounted: true, image: null }],
      semaglutidePlan,
      [new ConsentDefinition('terms', 'Terms', 'I agree to the <a href="/terms/">Terms</a>.', true, ['/terms/'])],
      promotionCapableCapabilities,
      Promotion.fromArray({ code: 'SAVE10', discount_cents: 1000 }),
      'USD',
      1,
      [semaglutidePlan],
      false,
    );

    const html = render({ ...baseGlobals, noindex: true, checkout });

    expect(html).toContain('jane@example.com');
    expect(html).toContain('Semaglutide');
    expect(html).toContain('3 Month Plan');
    expect(html).toContain('Add a Sleep Mask');
    expect(html).toContain('SAVE10');
    expect(html).toContain('I agree to the');
    expect(html).toContain('Pay Now');
    expect(html).toContain('Select Treatment Plan');
    expect(html).toContain('name="plan[semaglutide]"');
  });

  it('renders one plan picker per prescription, each naming its own line, plus the post-checkout note', () => {
    const totals = Totals.of(20000, null);
    const tadalafilPlan = { slug: 'tadalafil', name: 'Tadalafil', chosen: null, options: [{ id: 'plan-a', name: 'Plan A', price_cents: 5000 }] };
    const checkout = new CheckoutViewModel(
      { first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com', phone: '5551234567', address_line: '123 Main St', city: 'Springfield', territory: 'NY', postal_code: '10001' },
      {},
      null,
      totals,
      [],
      [],
      semaglutidePlan,
      [],
      capabilities,
      null,
      'USD',
      1,
      [semaglutidePlan, tadalafilPlan],
      true,
    );

    const html = render({ ...baseGlobals, noindex: true, checkout });

    expect(html).toContain('name="plan[semaglutide]"');
    expect(html).toContain('name="plan[tadalafil]"');
    expect(html).toContain('quick steps to complete after checkout');
  });

  it('renders field-level errors beside the right control, with no plan/bumps/promotion', () => {
    const totals = Totals.of(2000, null);
    const checkout = new CheckoutViewModel(
      { email: 'not-an-email' },
      { email: 'Enter an email address in the form name@example.com.', territory: 'Choose your state.' },
      null,
      totals,
      [{ slug: 'otc-item', name: 'OTC Item', quantity: 1, unit_price_cents: 2000, line_total_cents: 2000, variant_name: null, image: null, is_free: false, is_child: false }],
      [],
      null,
      [],
      capabilities,
      null,
      'USD',
      1,
    );

    const html = render({ ...baseGlobals, noindex: true, checkout });

    expect(html).toContain('Enter an email address in the form name@example.com.');
    expect(html).toContain('Choose your state.');
    expect(html).not.toContain('Select Treatment Plan');
  });

  it('renders a provider-hosted surface with the declared client config, token field and live challenge', () => {
    const hosted = new AdapterCapabilities('hosted', false, SCOPE_ORDER_LEVEL, STRATEGY_TOKENIZATION, SURFACE_PROVIDER_HOSTED, [], [], 'Hosted.', false, false, false, false, [], { publishable_key: 'pk_test_1', script: 'https://js.example.com/v3' }, true);
    const checkout = new CheckoutViewModel({}, {}, null, Totals.of(2000, null), [], [], null, [], hosted, null, 'USD', 1, [], false, 'challenge_secret');

    const html = render({ ...baseGlobals, noindex: true, checkout });

    expect(html).toContain('id="payment-provider-surface"');
    expect(html).toContain('name="payment_token"');
    expect(html).toContain('pk_test_1');
    expect(html).toContain('data-confirm-url="/checkout/confirm/"');
    expect(html).toContain('data-challenge="challenge_secret"');
    expect(html).toContain('<script src="https://js.example.com/v3" defer></script>');
    expect(html).toContain('/assets/build/payment-hosted.js');
    expect(html).not.toContain('name="card_number"');
  });

  it('renders no challenge attribute and no provider script for theme-rendered card fields', () => {
    const checkout = new CheckoutViewModel({}, {}, null, Totals.of(2000, null), [], [], null, [], capabilities, null, 'USD', 1);

    const html = render({ ...baseGlobals, noindex: true, checkout });

    expect(html).toContain('name="card_number"');
    expect(html).not.toContain('data-challenge');
    expect(html).not.toContain('payment-none.js');
  });

  describe('one form, so every sub-action posts what the buyer typed', () => {
    function happyPath(caps: AdapterCapabilities): string {
      const checkout = new CheckoutViewModel(
        { first_name: 'Jane', email: 'jane@example.com' },
        {},
        null,
        Totals.of(15000, null),
        [],
        [{ key: 'sleep-mask', slug: 'sleep-mask', headline: 'Add a Sleep Mask', body: 'Free with your order.', name: 'Sleep Mask', price_cents: 0, catalog_price_cents: 500, discounted: true, image: null }],
        semaglutidePlan,
        [],
        caps,
        Promotion.fromArray({ code: 'SAVE10', discount_cents: 1000 }),
        'USD',
        1,
        [semaglutidePlan],
        false,
      );
      return render({ ...baseGlobals, noindex: true, checkout });
    }

    const submitButtons = (html: string): string[] => html.match(/<button[^>]*type="submit"[^>]*>/g) ?? [];

    it('renders no second form: plan, bump and promo are formaction buttons of the checkout form', () => {
      const html = happyPath(promotionCapableCapabilities);

      expect((html.match(/<form\b/g) ?? []).length).toBe(1);
      // The only control outside the form is a remove button, and it names the checkout form.
      expect(html.match(/\sform="[^"]*"/g) ?? []).toEqual((html.match(/\sform="checkout-form"/g) ?? []));
      expect(html).toMatch(/<button type="submit" formaction="\/checkout\/plan" name="plan\[semaglutide\]" value="plan-3mo" aria-pressed="true"/);
      expect(html).toMatch(/<button type="submit" formaction="\/checkout\/plan" name="plan\[semaglutide\]" value="plan-1mo" aria-pressed="false"/);
      expect(html).toMatch(/<button type="submit" formaction="\/checkout\/bump" name="bump_slug" value="sleep-mask"/);
      expect(html).toMatch(/<button type="submit" formaction="\/checkout\/promo\/remove"/);
      expect(html).toMatch(/<input type="text" id="checkout-discount"[^>]*name="discount_code"/);
    });

    it('answers Enter with the hidden apply-code button, never Pay Now or a sub-action', () => {
      const first = submitButtons(happyPath(promotionCapableCapabilities))[0];

      expect(first).toContain('formaction="/checkout/promo"');
      expect(first).toContain('data-promo-apply');
      expect(first).toContain('data-default-guard');
    });

    it('answers Enter with nothing at all when the provider has no discount codes', () => {
      const first = submitButtons(happyPath(capabilities))[0];

      expect(first).toContain('disabled');
      expect(first).toContain('data-default-guard');
      expect(first).not.toContain('data-checkout-submit');
    });
  });

  describe('subscriptions', () => {
    const hosted = new AdapterCapabilities('stripe', true, SCOPE_ORDER_LEVEL, STRATEGY_TOKENIZATION, SURFACE_PROVIDER_HOSTED, [], [], 'Hosted.', false, false, false, true, [], { publishable_key: 'pk_test_1' }, true);
    const nad = {
      slug: 'nad',
      name: 'Aritra Nad+',
      variant_name: 'Aritra Nad+',
      chosen: 'plan-b',
      options: [
        { id: 'plan-a', name: 'Aritra Boost Energy', description: 'Best for multi-product care', price_cents: 2000 },
        { id: 'plan-b', name: 'Nad+ Simple Plan', description: '', price_cents: 3000 },
      ],
    };

    function page(subscriptions: unknown[], notice: string, settlement: string): string {
      const checkout = new CheckoutViewModel({}, {}, null, Totals.of(3000, null), [], [], null, [], hosted, null, 'USD', 1, [], false, null, subscriptions as never, notice, settlement);
      return render({ ...baseGlobals, noindex: true, checkout });
    }

    it('lists every plan of the line, the chosen one pressed, each posting subscription[slug]', () => {
      const html = page([nad], CheckoutViewModel.NOTICE_CHARGE, 'capture');

      expect(html).toContain('Select Subscription');
      expect(html).toContain('Aritra Nad+ · Aritra Nad+');
      expect(html).toMatch(/formaction="\/checkout\/subscription" name="subscription\[nad\]" value="plan-a" aria-pressed="false"/);
      expect(html).toMatch(/formaction="\/checkout\/subscription" name="subscription\[nad\]" value="plan-b" aria-pressed="true"/);
      expect(html).toContain('Best for multi-product care');
      expect(html).toContain('$30.00');
    });

    it('tells a subscription that takes the money it is charged today, and sets the card form to capture', () => {
      const html = page([nad], CheckoutViewModel.NOTICE_CHARGE, 'capture');

      expect(html).toContain('Your card will be charged today for the first payment of your subscription.');
      expect(html).not.toContain('Payment authorization will be held');
      expect(html).toContain('data-settlement="capture"');
    });

    it('keeps the hold notice, and a manual-capture card form, when the order is held', () => {
      const html = page([], CheckoutViewModel.NOTICE_HOLD, 'authorize');

      expect(html).not.toContain('Select Subscription');
      expect(html).toContain('Payment authorization will be held');
      expect(html).toContain('data-settlement="authorize"');
    });
  });

  it("puts a remove button on the buyer's own lines only, posting the checkout form to /checkout/remove", () => {
    const checkout = new CheckoutViewModel(
      { first_name: 'Jane' },
      {},
      null,
      Totals.of(3100, null),
      [
        { slug: 'nad', name: 'Aritra Nad+', quantity: 1, unit_price_cents: 3000, line_total_cents: 3000, variant_name: null, image: null, is_free: false, is_child: false },
        { slug: 'cc', name: 'Minoxidil CC', quantity: 1, unit_price_cents: 100, line_total_cents: 100, variant_name: null, image: null, is_free: false, is_child: true },
      ],
      [],
      null,
      [],
      capabilities,
      null,
      'USD',
      1,
    );
    const html = render({ ...baseGlobals, noindex: true, checkout });

    expect(html).toMatch(/<button type="submit" form="checkout-form" formaction="\/checkout\/remove" name="remove_slug" value="nad"/);
    expect(html).not.toContain('name="remove_slug" value="cc"');
  });
});
