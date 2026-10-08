import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ejs from 'ejs';
import { UpsellViewModel } from '../../src/upsell/upsell-view-model';

/**
 * Renders `views/pages/upsell.ejs` against a real `UpsellViewModel` — the shape `UpsellController`
 * assembles. The end-to-end e2e test (`checkout-to-receipt.e2e-spec.ts`) never exercises this
 * template directly, since `config/upsells.ts` ships empty and the queue is spent before any
 * offer is ever shown — this is the dedicated proof that a populated offer actually renders.
 */
describe('upsell page renders', () => {
  const viewsDir = join(process.cwd(), 'views');

  function render(locals: Record<string, unknown>): string {
    return ejs.render(readFileSync(join(viewsDir, 'pages/upsell.ejs'), 'utf8'), locals, {
      views: [viewsDir],
      filename: join(viewsDir, 'pages/upsell.ejs'),
    });
  }

  const baseGlobals = {
    csrf_token: 'csrf-token',
    url: (p: string) => p,
    asset: (n: string) => '/assets/build/' + n,
    money: (c: number) => '$' + (c / 100).toFixed(2),
    site: { name: 'AsterMD', url: 'http://localhost' },
    app_env: 'test',
    portal_url: null,
    cart: { count: 0, subtotal_cents: 0, notice: null, lines: [], actions: { assessment: null, checkout: null, terminal: null } },
  };

  it('renders the offer with an image, bullets, position, and a configured footnote', () => {
    const upsell = new UpsellViewModel(
      'daily-wellness-pack',
      'Wait! Your Exclusive Offer!',
      'Enhance Your Wellness Journey',
      'Optimize your daily routine with our clinically backed supplement plan.',
      ['Immune Support formulated for daily resilience', 'Energy Boost without the midday crash'],
      '/assets/media/upsell.png',
      'Daily Wellness Vitamin Pack',
      899,
      'USD',
      'Add to Order',
      'No Thanks',
      'Billed monthly. Cancel by contacting support.',
      '/upsell/accept/',
      '/upsell/decline/',
      1,
      2,
    );

    const html = render({ ...baseGlobals, noindex: true, upsell });

    expect(html).toContain('Enhance Your Wellness Journey');
    expect(html).toContain('Daily Wellness Vitamin Pack');
    expect(html).toContain('$8.99');
    expect(html).toContain('Immune Support formulated for daily resilience');
    expect(html).toContain('Offer 1 of 2');
    expect(html).toContain('Billed monthly. Cancel by contacting support.');
    expect(html).toContain('/upsell/accept/');
    expect(html).toContain('/upsell/decline/');
  });

  it('omits the footnote and image entirely when the offer configures none', () => {
    const upsell = new UpsellViewModel(
      'simple-offer',
      '',
      'A Simple Offer',
      '',
      [],
      null,
      'Widget',
      500,
      'USD',
      'Add to Order',
      'No Thanks',
      null,
      '/upsell/accept/',
      '/upsell/decline/',
      1,
      1,
    );

    const html = render({ ...baseGlobals, noindex: true, upsell });

    expect(html).toContain('A Simple Offer');
    expect(html).not.toContain('Cancel anytime');
    expect(html).not.toContain('alt="Widget"');
  });
});
