# Storefront Intake Website

Static marketing/intake site for **AsterMD**, a telehealth brand (US-based physicians,
no insurance required, ships in 3-5 days). No backend, no build step, no framework -
plain HTML + Tailwind CDN + vanilla JS.

## Tech stack

- Plain HTML5, no bundler/build step. Open `index.html` / `treatments.html` directly
  in a browser (`file://`) to preview.
- **Tailwind CSS via CDN** (`https://cdn.tailwindcss.com`), configured inline in a
  `<script>tailwind.config = {...}</script>` block in each page's `<head>`.
- **Lucide icons** via CDN (`lucide@latest/dist/umd/lucide.js`), rendered from
  `<i data-lucide="...">` placeholders by `lucide.createIcons()` at the end of `<body>`.
- **Inter** (Google Fonts) substitutes for the Figma spec's proprietary
  "Helvetica Now Display/Text".
- Vanilla JS in `assets/js/script.js` - no dependencies, no modules.

## File structure

```
index.html              Homepage: hero, promo banner, treatments grid, how-it-works,
                         why-choose-us, testimonials, FAQ, CTA, footer
treatments.html          Treatments listing page: filters + full treatments grid
assets/css/styles.css    Design tokens (CSS variables) + a few base/utility rules
assets/js/script.js      Mobile nav toggle, FAQ accordion, promo banner carousel,
                         testimonials carousel
assets/images/           Product photos, avatars, badges, decorative art
.claude/settings.json    Local permission allowlist for this project
```

## Design tokens (single source of truth)

**`assets/css/styles.css`** defines every colour, radius, shadow, spacing alias, font
stack, and transition as a CSS variable under `:root`. Each page's inline
`tailwind.config` block maps those variables into Tailwind theme keys (e.g.
`colors.primary.DEFAULT = 'var(--primary)'`, `borderRadius.lg = 'var(--radius-lg)'`).

**To reskin anything, edit the variable in `styles.css` - never hardcode a new hex
value or one-off utility in the HTML.** Key tokens:

- Colors: `--primary` (teal `#14b8a6`, buttons/links), `--secondary` (navy `#162b56`,
  topbar/dark surfaces), `--text-primary/secondary/muted/faint`, `--border`, `--divider`.
- Radius: `--radius-sm` 5px (buttons, form controls), `--radius-md` 12px (small
  floating cards), `--radius-lg` 20px (content cards), `--radius-xl` 30px (hero
  imagery/banners).
- Fonts: `--font-heading` / `--font-body`, both `'Inter', ui-sans-serif, system-ui, sans-serif`.

**Known CDN Tailwind limitation:** opacity modifiers (`bg-primary/50`) don't work on
custom `var()`-based colors - the CDN build silently drops the utility instead of
falling back to `color-mix()`. Where a translucent variant is genuinely needed, it's
baked into its own 8-digit hex token in `styles.css` (e.g. `--border-soft`,
`--overlay-strong`) instead of relying on a `/NN` suffix in a class.

## Typography weight convention

`font-bold` (700) is used for:

- Each page's main `<h1>` title - e.g. the hero headline on `index.html`, the
  product name on `product-details.html`, the question heading on each intake step.
- Top-level section headings within a page - e.g. `index.html`'s "Our Treatments",
  "How Your Treatment Works", "Why Choose Us", "What Our Patients Say", "Frequently
  Asked Questions", "Start Your Transformation Today!", and the promo banner's
  "Start your weight loss journey today!"; `product-details.html`'s "How Your
  Treatment Works".

`font-medium` (500) is used for everything smaller/nested than that: card titles
(treatment card names, checkout section headings like "Contact"/"Delivery"),
testimonial attributions, badges/pills, and other emphasis text. Payment-brand
wordmarks (Visa, Mastercard, PayPal, Afterpay) stay `font-bold` regardless - they're
mimicking real card-network logos, not app headings, so the heading/card rule above
doesn't apply to them.

## Card image sizing convention

Treatment cards (`index.html` "Our Treatments" section, `treatments.html` grid) use a
fixed-height image thumbnail (`h-[134px] w-full sm:w-[139px]`) that does **not**
stretch to match the card's text-column height, even on desktop (`sm:flex-row`) where
image and content sit side by side. This is intentional - the image stays a small
fixed thumbnail regardless of how tall the text/price/buttons column grows; don't
"fix" this by adding `sm:h-auto` or similar stretch behavior unless explicitly asked.

## JS behaviors (`assets/js/script.js`)

- **Mobile nav toggle** - `#mobile-menu-btn` toggles `#mobile-menu` and swaps
  menu/close icon visibility.
- **FAQ accordion** (`#faq-accordion`) - single-open accordion; JS sets `max-height`
  inline on `.faq-panel` for the open/close animation (`styles.css` provides the
  transition + a no-JS fallback max-height).
- **Promo banner carousel** - chrome-only, currently a single designed slide with
  dot/arrow controls wired up.
- **Testimonials carousel** - horizontal scroll track (`#testimonial-track`);
  scrollbar hidden via `styles.css` `::-webkit-scrollbar` rule while staying scrollable.

## Conventions when editing

- **Icons: always Lucide, never hand-authored inline `<svg>`.** Every icon (arrows,
  chevrons, cart, menu/close, section-icon circles, etc.) is a Lucide icon placed as
  `<i data-lucide="icon-name" class="...">` and rendered by `lucide.createIcons()` at
  the end of `<body>` - see `index.html` for the pattern. The **only** exception is the
  AsterMD logo mark (header + footer), which is a hand-coded inline `<svg>` because
  it's a brand asset, not an icon in Lucide's set - copy it verbatim from an existing
  page rather than redrawing it. Don't introduce a new inline `<svg>` for anything
  that could instead be a `data-lucide` name.
- Every new color/radius/shadow/spacing value goes in `styles.css` as a variable
  first, then gets wired into the `tailwind.config` block - never add a raw hex value
  or magic number directly to a Tailwind class in the HTML.
- Keep `index.html` and `treatments.html`'s shared chrome (header, footer, nav,
  tailwind.config) in sync when changing one - they're independent files, not
  templated/shared.
- This is a static site with no test suite and no build step - verify changes by
  opening the HTML file directly in a browser.
