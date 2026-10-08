import { CatalogProduct } from '../src/domain/product-catalog';

/**
 * Ported from storefront-lamp/config/products.generated.example.php — the committed shape
 * reference, preserved here once `theme:sync` became real (Phase 10) and started actually writing
 * `config/products.generated.ts` from live EMR channel data. This file is never imported by the
 * application; it exists so a fresh checkout (or a reader who has never run `theme:sync --apply`)
 * can see the shape `CatalogBuilder.build()` produces without needing a live channel. Not kept in
 * sync with `products.generated.ts` after a real sync — it is a snapshot, not a fallback.
 */
export interface GeneratedCatalog {
  channel: { id: string; name: string; currency: string };
  products: Record<string, CatalogProduct>;
}

const products: CatalogProduct[] = [
  {
    slug: 'aa1111-semaglutide',
    name: 'Semaglutide',
    kind: 'rx',
    subtitle: 'Weekly injectable weight-loss treatment',
    categories: ['Weight Loss'],
    condition_treated: ['Obesity', 'Weight Management'],
    description:
      'A once-weekly GLP-1 injectable that helps regulate appetite and blood sugar, prescribed as part of a physician-guided weight-loss plan.',
    price_cents: 29900,
    price_unit: '/ month',
    image: '/assets/media/semaglutide.png',
    gallery: ['/assets/media/semaglutide.png'],
    badges: [{ label: 'Most Popular', variant: 'primary' }],
    emr_product_id: 'emr-semaglutide-001',
    teleform_id: 'teleform-weight-loss-intake',
    variants: [
      { id: 'semaglutide-monthly', name: 'Monthly', price_cents: 29900 },
      { id: 'semaglutide-quarterly', name: 'Quarterly', price_cents: 79900 },
    ],
    bundles: ['aa1111-syringe-kit'],
    attachments: [],
  },
  {
    slug: 'aa1112-tirzepatide',
    name: 'Tirzepatide',
    kind: 'rx',
    subtitle: 'Dual-action weekly injectable',
    categories: ['Weight Loss'],
    condition_treated: ['Obesity', 'Weight Management'],
    description:
      'A dual GIP/GLP-1 receptor agonist, injected weekly, for buyers who need a stronger weight-loss response than semaglutide alone.',
    price_cents: 39900,
    price_unit: '/ month',
    image: '/assets/media/tirzepatide.svg',
    gallery: ['/assets/media/tirzepatide.svg'],
    badges: [],
    emr_product_id: 'emr-tirzepatide-001',
    teleform_id: 'teleform-weight-loss-intake',
    variants: [
      { id: 'tirzepatide-monthly', name: 'Monthly', price_cents: 39900 },
      { id: 'tirzepatide-quarterly', name: 'Quarterly', price_cents: 109900 },
    ],
    bundles: ['aa1112-syringe-kit'],
    attachments: [],
  },
  {
    slug: 'aa1113-sildenafil',
    name: 'Sildenafil',
    kind: 'rx',
    subtitle: 'On-demand ED treatment',
    categories: ["Men's Health"],
    condition_treated: ['Erectile Dysfunction'],
    description: 'The generic form of Viagra, dosed as needed, prescribed after an online consultation.',
    price_cents: 4500,
    price_unit: '/ month',
    image: '/assets/media/sildenafil.svg',
    gallery: ['/assets/media/sildenafil.svg'],
    badges: [],
    emr_product_id: 'emr-sildenafil-001',
    teleform_id: 'teleform-mens-health-intake',
    variants: [
      { id: 'sildenafil-25mg', name: '25mg', price_cents: 4500 },
      { id: 'sildenafil-50mg', name: '50mg', price_cents: 5500 },
      { id: 'sildenafil-100mg', name: '100mg', price_cents: 6500 },
    ],
    bundles: [],
    attachments: [],
  },
  {
    slug: 'aa1114-finasteride',
    name: 'Finasteride',
    kind: 'rx',
    subtitle: 'Daily hair-loss treatment',
    categories: ["Men's Health", 'Hair Loss'],
    condition_treated: ['Male Pattern Baldness'],
    description: 'A once-daily tablet that slows hair loss and, in many buyers, regrows hair over several months.',
    price_cents: 3000,
    price_unit: '/ month',
    image: '/assets/media/finasteride.png',
    gallery: ['/assets/media/finasteride.png'],
    badges: [],
    emr_product_id: 'emr-finasteride-001',
    teleform_id: 'teleform-hair-loss-intake',
    variants: [{ id: 'finasteride-1mg', name: '1mg', price_cents: 3000 }],
    bundles: [],
    attachments: [],
  },
  {
    slug: 'aa1115-vitamin-d3',
    name: 'Vitamin D3',
    kind: 'otc',
    subtitle: 'Daily immune & bone-health support',
    categories: ['Wellness'],
    condition_treated: [],
    description: 'A high-potency daily softgel supporting bone density, immune function, and mood.',
    price_cents: 1800,
    price_unit: '/ month',
    image: '/assets/media/vitamin-d3.svg',
    gallery: ['/assets/media/vitamin-d3.svg'],
    badges: [],
    emr_product_id: 'emr-vitamin-d3-001',
    variants: [{ id: 'vitamin-d3-standard', name: 'Standard', price_cents: 1800 }],
    bundles: [],
    attachments: [],
  },
  {
    slug: 'aa1116-biotin',
    name: 'Biotin Complex',
    kind: 'otc',
    subtitle: 'Hair, skin & nail support',
    categories: ['Wellness', 'Hair Loss'],
    condition_treated: [],
    description: 'A daily biotin and collagen complex supporting hair thickness, skin, and nail strength.',
    price_cents: 2200,
    price_unit: '/ month',
    image: '/assets/media/biotin.svg',
    gallery: ['/assets/media/biotin.svg'],
    badges: [],
    emr_product_id: 'emr-biotin-001',
    variants: [{ id: 'biotin-standard', name: 'Standard', price_cents: 2200 }],
    bundles: [],
    attachments: [],
  },
  // Bundled attachments — kind: 'free-addon', not returned by listedProducts(), only reachable as
  // a cart line attached to a parent (CartRules.attachChildren()).
  {
    slug: 'aa1111-syringe-kit',
    name: 'Syringe Kit',
    kind: 'free-addon',
    description: 'Sterile syringes and alcohol swabs for at-home injection, included at no extra cost.',
    price_cents: 0,
    image: '/assets/media/syringe-kit.svg',
    gallery: ['/assets/media/syringe-kit.svg'],
    emr_product_id: 'emr-syringe-kit-001',
    variants: [{ id: 'syringe-kit-standard', name: 'Standard', price_cents: 0 }],
    bundles: [],
    attachments: [],
  },
  {
    slug: 'aa1112-syringe-kit',
    name: 'Syringe Kit',
    kind: 'free-addon',
    description: 'Sterile syringes and alcohol swabs for at-home injection, included at no extra cost.',
    price_cents: 0,
    image: '/assets/media/syringe-kit.svg',
    gallery: ['/assets/media/syringe-kit.svg'],
    emr_product_id: 'emr-syringe-kit-001',
    variants: [{ id: 'syringe-kit-standard', name: 'Standard', price_cents: 0 }],
    bundles: [],
    attachments: [],
  },
];

export const productsGenerated: GeneratedCatalog = {
  channel: { id: 'example-channel', name: 'AsterMD Example Channel', currency: 'USD' },
  products: Object.fromEntries(products.map((p) => [p.slug, p])),
};
