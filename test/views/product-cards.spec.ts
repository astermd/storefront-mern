import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ejs from 'ejs';

/**
 * Renders the product-card surfaces (`treatments.ejs`, `product.ejs`, the `get-started` partial)
 * to prove the 0.0.6 UI fixes from storefront-lamp: filter values that match the cards' own data
 * attributes, "Get Started" posting the cart-add form, and the product page's plan price hook.
 */
describe('product card surfaces', () => {
  const viewsDir = join(process.cwd(), 'views');

  function render(file: string, locals: Record<string, unknown>): string {
    const path = join(viewsDir, file);
    return ejs.render(readFileSync(path, 'utf8'), locals, { views: [viewsDir], filename: path });
  }

  const globals = {
    csrf_token: 'csrf-token',
    url: (p: string) => p,
    asset: (n: string) => '/assets/build/' + n,
    money: (c: number) => '$' + (c / 100).toFixed(2),
    site: { name: 'AsterMD', url: 'http://localhost' },
    app_env: 'test',
    maps_api_key: null,
    portal_url: null,
    footer_products: [],
    noindex: false,
    current_path: '/treatments/',
    cart: { count: 0, subtotal_cents: 0, notice: null, lines: [], actions: { assessment: null, checkout: null, terminal: null } },
  };

  const variants = [
    { id: 'v-1', name: '1 Month', price_cents: 5000 },
    { id: 'v-3', name: '3 Months', price_cents: 12000 },
  ];
  const rx = { slug: 'sema', name: 'Semaglutide', kind: 'rx', categories: ['Weight Loss'], description: 'd', image: '/i.png', variants, price_cents: 5000 };
  const otc = { slug: 'vit', name: 'Vitamin', kind: 'otc', categories: ['Wellness'], description: 'd', image: '/i.png', variants: [], price_cents: 900 };

  it('Get Started posts the first plan to the cart, with the assessment intent for a prescription and checkout otherwise', () => {
    const rxHtml = render('partials/get-started.ejs', { ...globals, product: rx, icon_class: 'size-4' });
    expect(rxHtml).toContain('action="/cart/add"');
    expect(rxHtml).toContain('name="slug" value="sema"');
    expect(rxHtml).toContain('name="variant_id" value="v-1"');
    expect(rxHtml).toContain('name="intent" value="assessment"');
    expect(rxHtml).toContain('class="size-4"');

    const otcHtml = render('partials/get-started.ejs', { ...globals, product: otc });
    expect(otcHtml).toContain('name="intent" value="checkout"');
    expect(otcHtml).toContain('name="variant_id" value=""');
  });

  it('the treatments page filters on the same values its cards carry, and has an empty state', () => {
    const html = render('pages/treatments.ejs', { ...globals, products: [rx, otc], categories: ['Weight Loss', 'Wellness'] });

    expect(html).toContain('name="filter-condition" value="Weight Loss"');
    expect(html).toContain('name="filter-type" value="rx"');
    expect(html).toContain('name="filter-type" value="otc"');
    expect(html).toContain('data-treatment-card data-kind="rx" data-categories="[&#34;Weight Loss&#34;]"');
    expect(html).toContain('id="treatments-empty"');
    expect(html).toContain('name="intent" value="assessment"');
  });

  it('the product page shows the chosen plan\'s price from a hook, and only a prescription offers the assessment', () => {
    const locals = { ...globals, current_path: '/products/sema/', assessment_available: true, related_products: [] };

    const rxHtml = render('pages/product.ejs', { ...locals, product: { ...rx, gallery: ['/i.png'], badges: [] } });
    expect(rxHtml).toContain('<span id="product-price">$50.00</span>');
    expect(rxHtml).toContain('data-price="$120.00"');
    expect(rxHtml).toContain('name="intent" value="assessment"');

    const otcHtml = render('pages/product.ejs', { ...locals, product: { ...otc, gallery: ['/i.png'], badges: [] } });
    expect(otcHtml).not.toContain('name="intent" value="assessment"');
    expect(otcHtml).toContain('name="intent" value="checkout"');
  });
});
