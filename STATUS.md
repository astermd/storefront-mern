# Port status

Live progress tracker for the storefront-lamp → storefront-mern port. `MERN.md` is the target
architecture; this file is where things currently stand against it. Update this alongside the
work, not after the fact — a status file that lags the code is worse than none.

Last updated: 2026-09-24.

---

## Phase status

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Project init & toolchain | ✅ Done |
| 1 | Skeleton, bootstrap, CoreModule, tokens, error boundaries | ✅ Done |
| 2 | 9-slot middleware pipeline | ✅ Done |
| 3 | Persistence (Prisma + SQLite) | ✅ Done |
| 4 | Domain: Cart, CartRules, FunnelRouter, StepPreconditions | ✅ Done |
| 5 | Catalog + home/product/treatments/cart routes + templates | ✅ Done |
| — | **Real EMR integration** (Session/Cart/Verification/Teleform/Intake/Lead/Identity) | ✅ Done — not in the original 11-phase plan |
| 6 | Forms/intake engine + verify step | ✅ Done |
| 7 | Checkout (order-of-operations, idempotency, payment) | ✅ Done |
| 8 | Upsell + completion + receipt + teardown | ✅ Done |
| 9 | SEO + legal pages + error-page X-Robots-Tag correctness | ✅ **Done**, including the asset pipeline (deferred earlier in this session, now built — see note below) |
| 10 | Remaining console commands + observability | ✅ **Done** — see note below |
| — | **Real Vrio + CheckoutChamp payment adapters** | ✅ Done — not in the original 11-phase plan, user-directed reversal of the Null-payment-only decision |
| 11 | Test suite consolidation | 🟡 In progress — see note below |

All of Phases 0–10 are covered by automated tests and were also manually smoke-tested (curl
click-through, or — for the intake templates, which the real EMR channel can't currently exercise
end-to-end — a dedicated render test driving every field type through the real view-model code; for
Phase 10, every console command run once for real via `node dist/src/console/main.js <name>`).

---

## Stack, as actually built (departs from MERN.md's original draft)

- **Prisma**, not Kysely — on **`7.10.0`** (the real latest *stable* release; npm's `latest`
  dist-tag resolves to an unstable `8.0.0-rc.15` — see `CLAUDE.local.md` for the standing rule
  this taught). Prisma 7 removed `schema.prisma`'s inline `datasource.url` entirely: the CLI reads
  its connection string from `prisma.config.ts` now, and the app's own `PrismaClient` takes a
  driver adapter (`@prisma/adapter-better-sqlite3`) instead of reading `DATABASE_URL` on its own —
  see `prisma.config.ts` and `src/database/connection-factory.ts`'s doc comments. Re-verified with
  a real runtime boot + DB write, not just `npm test`. Prisma 7+ also ships an AI-agent safety
  guard on destructive CLI commands (`db push --accept-data-loss`) — see `CLAUDE.local.md`.
- **eslint/typescript-eslint/prettier bumped to latest stable** (`eslint@10.11.0`,
  `typescript-eslint@8.70.1`, `prettier@3.9.8`) — no config breakage, `npm run lint` stayed clean.
- **EJS**, not Nunjucks — no template inheritance; every page includes its own head/foot partials.
- **class-validator DTOs** on every mutating route with a *static* body shape — additive to the
  domain-layer validators. The intake save/submit/capture endpoints deliberately skip a DTO
  class: their body shape is the teleform's own field set, which is data, not code, so no fixed
  DTO can describe it — they take `@Body() body: Record<string, unknown>` directly (Nest's
  `ValidationPipe` only validates class-typed bodies, so this is a real bypass, not an oversight).
- **Node `>=22`** (not 24 — an earlier `>=24` pin in `package.json`/`.nvmrc` was a mistake, fixed).

## Real EMR integration — what's actually live

Reverses the original plan's "every EMR-family port stays Null-bound for the whole effort"
decision, after the real, official `@astermd-hq/sdk` npm package was found and real dev-sandbox
credentials were made available (`storefront-lamp/.env`).

**Real, backed by `@astermd-hq/sdk`, config-gated against Null** (all on
`config.app.session.analytics`, except where noted):
- `SESSION_GATEWAY` → `EmrSessionGateway` (mints/looks up analytics sessions)
- `CART_GATEWAY` → `EmrCartGateway` (mirrors cart contents)
- `EMR_VERIFICATION_GATEWAY` → `EmrVerificationGateway` (email/address checks, gated on
  `config.app.features.emrVerification`)
- `TELEFORM_GATEWAY` → `EmrTeleformGateway` (teleform metadata + definition fetch)
- `INTAKE_GATEWAY` → `EmrIntakeGateway`, wrapped in `RecordingIntakeGateway` (always writes a
  local `events` audit row regardless of which gateway is inside)
- `LEAD_GATEWAY` → `EmrLeadGateway` (opportunity create/update)
- `IDENTITY_GATEWAY` → `EmrIdentityGateway` (KYC checks, gated on `config.verification.enabled`
  — separately from the other six, which all key off `session.analytics`)

`NODE_ENV=test` forces every one of these flags false, so the test suite never reaches the
network — re-verified after every addition, not assumed.

**Still Null-only**: `PAYMENT_ADAPTER` (wired for real via `AdapterRegistry` in Phase 7, but zero
adapters are ever registered by design — see MERN.md) and `CHECKOUT_EVENT_REPORTER` (Phase 7 built
its port + Null implementation only, since it's structurally unreachable while no real payment
adapter exists to place an order).

**Proven end-to-end against the real dev-sandbox EMR** (`health.api.dev.besimplified.net`), twice:
1. A bare `curl` (no cookie) minted a real analytics session, confirmed on record via a direct
   SDK call (`visit_page` event, geo-resolved IP).
2. A full cart-add → funnel-routing → intake-controller → `EmrTeleformGateway` round-trip: adding
   an Rx product with a real variant selected correctly routed to `/intake/medical/`, correctly
   called the real EMR for the teleform (which 404s, since this example catalog's teleform ids
   don't exist in the real channel), and correctly rendered the `form-unavailable` degrade page —
   the exact designed failure path, observed for real.

**Token caching**: `@astermd-hq/sdk`'s own `FileTokenStore`, at `storage/cache/emr-token.json` —
the same path and package storefront-lamp's PHP side already uses.

---

## Phase 6 — Forms/intake engine + verify step (done)

The whole Forms domain, unit-tested (34 new tests across `Bmi`/`DateAnswer`/`RuleEvaluator`, plus
a full template-render test): `Definition`/`Field`/`Page`, `AnswerSet`/`AnswerEncoder`/
`AnswerValidator`, `RuleEvaluator` (ported with extra care as the single highest-risk file —
inverted condition defaults, per-join combinator indexing, phone normalization, membership
semantics; every test passed on the first run), `Disqualification`/`DisqualificationOutcome`/
`TerminationRule`, `TeleformSource`/`DefinitionCache`, the `TeleformGateway`/`IntakeGateway`/
`LeadGateway`/`IdentityGateway` families (`Emr*`/`Null*` pairs, config-gated), `RecordMapper`,
`LeadWriter`, `IntakeSession` (the orchestrator, exact persist-before-validate ordering intact),
`VerificationStep` (identity assembly via `Prefill` read backwards through the teleform's
`db_fields` map), `IntakeController`/`NotEligibleController`/`VerifyController`, all wired into
`AppModule`.

**Templates — all 18 field-type EJS partials built** (`field-text/boolean/choice-single/
choice-multi/date/number/dropdown/bmi/hidden/heading/form-header/paragraph/divider/alert/image/
form-progress/button/unsupported`) plus the `field.ejs` dispatcher, `partials/stepper.ejs`, and
both questionnaire pages (`pages/intake/form.ejs` for the server-rendered mode, `form-js-engine.ejs`
for the hosted-engine mode). Verified by a dedicated render test
(`test/forms/intake-templates.spec.ts`) that builds one definition covering every field type,
runs it through the real `FieldViewModel`/`RuleEvaluator` code (not hand-typed template locals),
and renders both page templates against the result — since this example catalog's teleform ids
don't exist in the real EMR channel, the live route can never reach a populated form to prove this
any other way.

**Client-side multi-page stepping, wired up post-Phase 10.** `public/js/intake.js` (copied verbatim
from storefront-lamp during the asset pipeline work) expects a specific `data-intake-*` attribute
contract that this port's `field.ejs`/`form.ejs`/`stepper.ejs` didn't actually emit — different
attribute names entirely (`data-field-name` vs. the script's `data-intake-field`), an inverted
`cols` → `sm:col-span-*` mapping, a flex-column page layout instead of the `grid-cols-1
sm:grid-cols-2` the script's markup expects, and a stepper using different CSS classes than the
ones `intake.js`'s own `updateStepper()` re-applies as the visitor advances. Fixed by porting
`field.twig`/`form.twig`/`stepper.twig`'s exact attribute contract from storefront-lamp field-for-
field: `field.ejs` now emits `data-intake-field`/`data-intake-type`/`data-intake-required`/
`data-intake-hidden`/`data-intake-conditions` with the correct `cols` logic; a new shared
`field-error.ejs` partial (`data-intake-error`, always rendered so the script has a stable node to
write into) replaces the inline error markup duplicated across 7 field-type partials;
`field-bmi.ejs` gained `data-intake-bmi`/`-target`/`-result`/`-score`; `form.ejs` gained
`data-intake-form`/`data-save-url`/`data-submit-url`/`data-capture-url`/`data-intake-rules`/
`data-intake-blocked`, the correct 2-column page grid, the eligibility interstitial, and one shared
Back/Continue nav (matching the script's own page-count-based submit-vs-advance logic, replacing
the previous per-page "Submit on the last page" markup that the script never actually drove);
`stepper.ejs` gained `data-funnel-stepper`/`data-stepper-*` and the exact done/active/upcoming class
strings `intake.js`'s `updateStepper()` hardcodes. **Verified with a real interactive test**, not
just visual inspection: a rendered two-page fixture, driven through a real browser via Playwright,
correctly advances from page 1 to page 2 on a genuine click — `data-intake-page-input`'s value
changes from `0` to `1`, the stepper re-styles step 1 as done (checkmark connector) and step 2 as
active, and the second page's own fields render. `test/forms/intake-templates.spec.ts` updated to
pass `definition` (present in the real controller's payload, missing from the test's hand-built
locals) and to match the ported copy's exact wording.

---

## Known gaps

None currently flagged.

## Bugs found and fixed this session

- **`cookie-parser` was never installed.** `SessionResolver`'s "cookie-present → trust it" branch
  reads `request.cookies`, which no middleware populated. Completely invisible under
  `NullSessionGateway` (no gateway ever returned a real UUID, so no cookie was ever set to fail to
  recognize) — the instant `EmrSessionGateway` went live, **every request re-minted a brand-new
  EMR session**, discovered via a real multi-request `curl` session. Fixed: installed
  `cookie-parser`, registered as the first entry in `AppModule`'s pinned-middleware chain.
- **`config/app.ts`'s `session.analytics` default was wrong** (defaulted `false` via an invented
  env knob; PHP has none and defaults `true` outside `APP_ENV=test`). Fixed to match exactly.
- **`AttributionMiddleware` had no route-exists guard.** The PHP original skips minting a session
  for a request that doesn't match any real route (a bot scan, a stray asset request), via an
  injected closure. This port never had an equivalent — invisible under Null-only, a real cost
  once `EmrSessionGateway` went live (a GET to any unmatched path minted a real, billable EMR
  session before `NotFoundController` got a say). Fixed via a new `RouteExistsChecker`
  (`src/support/route-exists-checker.ts`) that introspects Express 5's own router
  (`app.router.stack`, `layer.matchers`) to test-match a path against every *real* registered
  route, excluding the catch-all fallback. Fails open on any structural surprise. Verified live: a
  bot-scan-shaped path no longer sets `amd_session`, while static and dynamic real routes still do.
- **Prisma 6→7**: `latest` npm dist-tag is an unstable `8.0.0-rc.15`; the real latest stable is
  `7.10.0`, itself a breaking major bump (inline `datasource.url` removed — see above). Migrated
  cleanly; all tests + a real runtime boot re-verified afterward.

---

## Phase 7 — Checkout (done)

Full order-of-operations port of `core/Checkout/CheckoutService.php`, built from literal verbatim
source (BuyerValidator, CheckoutService, CheckoutController, the 3 repositories, Consents,
IdempotencyKey, CheckoutAttempt, PostChargeGuard, SettlementPolicy, OrderBumps, CheckoutResult/
CheckoutViewModel, ConsentDefinition/ConsentRecord — 17 files read directly rather than from a
research-agent summary, per this project's "grep before building on a summary" rule).

- **Domain/value objects** (`src/checkout/`): `totals`, `promotion`, `buyer-details`, `card-number`,
  `consent-definition`, `consent-record`, `consents`, `idempotency-key`, `checkout-attempt`,
  `post-charge-guard`, `settlement-policy`, `order-bump(s)`, `checkout-result`,
  `checkout-view-model`, `buyer-validator`, `prefill`, `checkout-event-reporter` +
  `null-checkout-event-reporter`, `order-recorder` + `null-order-recorder` +
  `database-order-recorder`.
- **`checkout.service.ts`** — the full `submit()`/`view()`/`toggleBump()`/`applyPromotion()`/
  `removePromotion()`/`choosePlan()` orchestrator, in the spec's exact order: rate-limit before
  anything costs money → re-price a stored promotion → validate buyer+consents together →
  re-run the geo gate → store the buyer *before* the provider call → claim the idempotency key →
  assemble one `OrderEnvelope` → mark the attempt sent → call the adapter → run
  `PostChargeGuard`-wrapped writes only after that. Every constant/copy string ported verbatim.
- **Repositories** (Prisma-backed): `checkout-attempt-repository.ts` (claim/renewClaim/markSent/
  recordOutcome/release — the exact conditional-update ownership-token semantics that prevent the
  PHP original's documented double-charge bug), `rate-limit-repository.ts` (fixed-window hit()),
  `order-repository.ts` (transactional insert of orders/order_lines/order_consents +
  findByReference). `prisma/schema.prisma`'s `Order` model gained `settlement`/`userAgent` columns
  (migration `20260923093528_checkout_settlement_user_agent`).
- **`src/support/`**: `request-context.ts` (CDN IP header precedence), `database-rate-limiter.ts`
  (fail-open fixed-window limiter over `RateLimitRepository`).
- **`src/upsell/`**: `upsell.ts` + `upsells.ts` — `queueFor()` (what `CheckoutService.placed()`
  needs at checkout success) is fully ported; `resolve()` exists for Phase 8's page but is unused
  until then. `config/upsells.ts` ships empty, matching the PHP original.
- **`PAYMENT_ADAPTER` wired for real**: `CoreModule` now binds it through `AdapterRegistry.for(config.payment.adapter)` — zero adapters ever registered, so every resolve falls through to
  `NullPaymentAdapter`, exactly per plan. `ORDER_RECORDER` binds to `DatabaseOrderRecorder`
  (real, DB-backed — orders must be recorded for receipt/reconciliation data to exist);
  `CHECKOUT_EVENT_REPORTER` stays Null-only (structurally unreachable while `PaymentAdapter` never
  places a real order — becomes real alongside a real payment adapter, not before one).
- **Routes**: `CheckoutController`/`CheckoutModule` (`GET`/`POST /checkout/`,
  `POST /checkout/bump|promo|promo/remove|plan`), all 4 sub-action DTOs plus `SubmitCheckoutDto`.
- **`views/pages/checkout.ejs`** — styled per `docs/mockup/mockup/intake/checkout.html` (two-column
  contact/delivery/payment form beside a sticky order summary); the mockup's shipping-method/
  express-checkout/PayPal/Afterpay/upsell-add-on sections are omitted as presentational content
  with no backing service in this port (declared gaps), not wired to nothing.
- **`JourneyState` grew 7 fields**: `promotion`, `promotionQuotedAgainst`, `acceptedBumps`,
  `consents`, `reusableCredential`, `upsellQueue`, `upsellCursor`, `upsellOutcomes` + methods
  `storeBuyer()`/`storeReusableCredential()`/`wipePaymentCredential()`.

**Bug found and fixed this session**: every `@Injectable()` class with an optional trailing
constructor parameter with no type Nest can resolve (`DatabaseRateLimiter`'s and
`CheckoutService`'s injected `clock?: () => string` test seam, `Consents`'s injected clock) failed
`AppModule` bootstrap with "Nest can't resolve dependencies… argument Function" — Nest tries to
resolve *every* constructor parameter, optional or not, unless marked `@Optional()`. Fixed by adding
`@Optional()` to all three. **A second bug, found via a real curl submit**: the checkout DTOs'
buyer-contact-detail fields (`first_name`, `email`, ...) had no `class-validator` decorators at
all — the global `ValidationPipe`'s `whitelist: true` silently deletes any property with zero
validation decorators before the controller ever sees it, which emptied every field on a real
submit. Fixed by decorating every field `@IsOptional() @IsString()` (a new shared
`BuyerContactFieldsDto` base class for the 3 sub-action DTOs that repeat the same 8 fields).

**Proven against a real running server, not just unit-tested**: a real multi-request `curl` session
— add an OTC product to cart, submit checkout with full buyer details, a test card, and consent —
correctly failed buyer validation when fields were empty (caught the `whitelist` bug), and once
fixed, correctly reached the priced-line-unmapped decline (`[13.19]`): the port's example catalog
has no product with a real provider `offer_id`/`product_id` mapping (a documented Phase 5/6 gap),
so every priced line is honestly declined with "One of the items in your order is not available for
purchase right now" *before* ever reaching `NullPaymentAdapter` — and a resubmit of the identical
form got the same fresh decline rather than an in-flight/duplicate answer, proving
`releaseQuietly()` correctly gives the idempotency key back on this decline path.

---

## Phase 8 — Upsell + completion + receipt + teardown (done)

Full port of `core/Upsell/*` and `core/Completion/*`, built from literal verbatim source
(`Upsell`, `UpsellQueue`, `UpsellResult`, `UpsellService`, `UpsellViewModel`, `Completion`,
`Receipt`, `ReceiptViewModel`, `UpsellController`, `ReceiptController` — 10 files read directly).

- **`JourneyState` grew 4 more fields** (`upsellQuotes`, `receipt`, `completedAt`) plus 5
  `UPSELL_*` outcome constants, and `upsellOutcomes` changed shape from Phase 7's placeholder
  array to the real `Record<key, outcome>` map the PHP original always used. The Phase 7
  `reusableCredential` field was renamed to `reusableCredentialData` with a new
  `reusableCredential()` *method* added alongside it, reconstructing the real `PaymentCredential`
  via `fromStorable()` — Phase 7 only ever needed to *write* the stored handle; Phase 8's
  `UpsellService.accept()` is the first thing that needs to *read* it back as a real, chargeable
  credential. New methods: `isComplete()`, `wipeForCompletion()`.
- **`src/upsell/`**: `upsell-queue.ts` (skip/advance/position over the durable queue — an entry
  the catalog can no longer resolve is skipped and logged the moment it's read, never left for a
  later render to trip over again), `upsell-result.ts`, `upsell-view-model.ts`, `upsell-service.ts`
  (the full `view()`/`accept()`/`decline()` orchestrator — reuses the *checkout's own*
  `checkout_attempts` idempotency guard rather than a second one, and `CheckoutAttempt.releasesKey()`
  rather than re-deriving it). `[16.11]`'s central rule — a declined/skipped/unresolvable upsell
  never traps the buyer, every path ends in a redirect further forward — is structural: `UpsellResult.redirectTo` is non-nullable, unlike `CheckoutResult`'s.
- **`src/completion/`**: `receipt.ts` (built from real Prisma order rows — `OrderRowForReceipt`
  types `OrderRepository.findByReference()`'s actual camelCase return shape directly, no
  snake_case translation layer needed), `receipt-view-model.ts`, `completion.ts` (the fire-once
  orchestrator — `wipeForCompletion()` runs last, after every action that still needs the
  attribution/buyer contact has already used them).
- **`CheckoutEventReporter` interface grew 5 methods** (`upsellOffered`/`upsellAccepted`/
  `upsellDeclined`/`journeyCompleted`/`treatmentsSynced`) — all no-ops on
  `NullCheckoutEventReporter`, for the same structural reason Phase 7 gave: unreachable while
  `PAYMENT_ADAPTER` never places a real order.
- **Routes**: `UpsellController`/`UpsellModule` (`GET /upsell/`, `POST /upsell/accept|decline`),
  `ReceiptController`/`ReceiptModule` (`GET /thank-you/`) — both thin, deciding nothing themselves.
- **`views/pages/upsell.ejs`, `thank-you.ejs`** — styled per `docs/mockup/mockup/intake/
  {upsell,thankyou}.html`. Deliberately omitted, since nothing in this port backs them: a case id
  (`ReceiptViewModel` carries none on purpose — the EMR's treatment record has a null
  `provider_case_id` at creation time), the delivery map, a separate billing address (`[13.2]`:
  billing = shipping), a shipping method/cost line (`config/app.ts`'s declared `shippingSelector:
  false` gap), and upsell.ejs's footnote is only ever the *configured* one — never a hardcoded
  "Cancel anytime", which `Upsell.php`'s own doc comment explains can only be written truthfully
  per deployment/per offer.

**Proven end-to-end against a real, fully-migrated test database** (not the suite's default
unmigrated in-memory one — this test pushes the real schema to a throwaway temp SQLite file, same
as `test/database.spec.ts`), with a stub `PaymentAdapter` that actually places (`AdapterCapabilities`
otherwise stays Null-shaped) and a `FakeSessionGateway`/`FakeCatalogProvider` swapped in for the
example catalog's real gap (no product in it carries a provider mapping — see Phase 7's own
section): a full `supertest` click-through — add to cart, submit checkout, land on `/upsell/`,
fall straight through to `/thank-you/` since no upsells are configured, see the real order and
reference on the receipt, reload the receipt and get the identical frozen snapshot (fire-once), and
then discover that `/checkout/`'s `cart_not_empty` precondition now fails (cart cleared on
placement) — which is also what triggers `[4.18]`'s delayed session-cookie teardown, confirmed by
checking order matters: visiting the receipt a second time has to happen *before* visiting any other
page, or the teardown already fired and the second receipt visit lands on a fresh, order-less
session instead. This also strengthens Phase 7's own coverage, which previously only exercised the
*decline* path (the example catalog's unmapped-line gap) — this is the first automated test of a
checkout that actually reaches `placed()`.

Two test-only fixtures were added along the way and are reusable by later phases:
`test/support/fake-session-gateway.ts` (mints a real, stable session uuid — `NullSessionGateway`
never does, so no journey persists across requests without this) and
`test/support/fake-catalog-provider.ts` (overriding `PRODUCT_CATALOG` alone is not enough for any
test touching `/products/:slug/` — `ProductDetailController` injects the concrete `CatalogProvider`
class directly rather than through the token; this fixture overrides `CatalogProvider` itself, which
`PRODUCT_CATALOG`'s `useExisting` binding also resolves through).

---

## Phase 9 — SEO + legal pages + error-page X-Robots-Tag correctness (done)

Ported from literal verbatim source: `RobotsPolicy.php`, `MetaResolver.php`, `PageMeta.php`,
`StructuredData.php` + its 4 emitters (`Organisation`, `WebSite`, `BreadcrumbList`, `Product`),
`RobotsController.php`, `SitemapController.php`, `SeoMiddleware.php`, the 3 `pages/legal/*.twig`
placeholder templates, and `structured-data.twig`.

- **`src/seo/`**: `robots-policy.ts` grew from Phase 1's bare `REFUSED` constant into the full
  per-path directive resolver (`directiveFor`/`refusesIndexing`/`isIndexable`/
  `indexingDiscouraged`, exact-beats-prefix / longer-prefix-beats-shorter specificity ranking with
  the doubled-score tie-break so object key order can never decide a match), `meta-resolver.ts`
  (title/description/canonical/social resolution chain — every product this EMR syncs carries an
  empty description, so a blank candidate falls *through* rather than satisfying the chain),
  `page-meta.ts` (the single-writer resolved-once value object).
- **`src/seo/structured-data/`**: `emitter.ts` (the one-emitter-per-type interface),
  `organisation.ts`, `web-site.ts` (conditional `SearchAction`, conditional `publisher` reference —
  never a dangling `@id`), `breadcrumb-list.ts` (a 1-crumb trail emits nothing), `product.ts`
  (`[24.9]`: the offer prices from the *resolved variant*, never the product-level figure, and
  availability is derived from whether that variant actually carries a provider mapping; `[24.10]`:
  an `rx` product publishes nothing unless the deployment explicitly permits it, and its breadcrumb
  trail is withheld too, since the last crumb would restate exactly what the product omission
  withheld), `structured-data.ts` (the graph assembler — every emitter independently switchable in
  `config/app.ts`'s `seo.structuredData`, defaulting **off** per key).
- **`CatalogProvider` grew a `channel()` getter** — Phase 5 discarded `CatalogMerger.merge()`'s
  `channel` field entirely; `StructuredData`'s offer needs the synced channel's currency (`[24.9]`:
  no currency configured means no offer is published, never a guessed one).
- **`SeoMiddleware` rewritten off Phase 2's always-`noindex` stub** onto real resolution: publishes
  a `res.locals.seo` object (`canonical`, the real per-path `robots` directive, `page` — a
  `PageMeta` a page can `.with(title, description, type)`) and sets `X-Robots-Tag` from the same
  directive on every response.
- **`partials/head.ejs` gained a canonical `<link>`, a structured-data include, and one behavioural
  change to the `<meta name="robots">` tag — additive, not a rewrite of the other ~30 templates
  that already call it.** Every page that passes its own explicit `noindex` (funnel steps, error
  pages) is completely unaffected. A page that passes **no opinion at all** (most of the marketing
  surface, and both legal pages as of this phase) now falls through to `seo.robots` instead of
  defaulting to indexable — closing a real disagreement `[24.2]` forbids: before this fallback, such
  a page's `X-Robots-Tag` header said `noindex` under `discourageIndexing` (every non-production
  environment) while its meta tag said nothing at all. Proven directly: `test/routes/
  legal.e2e-spec.ts` asserts the home page and all 3 legal pages agree, header vs. meta tag, under
  `NODE_ENV=test`.
- **Routes**: `RobotsController`/`SitemapController`/`SeoModule` (`GET /robots.txt`,
  `GET /sitemap.xml` — the sitemap's exclusions are `RobotsPolicy.isIndexable()` calls, never a
  second hand-kept list, so a funnel step added later needs one robots rule, not two files kept in
  sync), `LegalController`/`LegalModule` (`GET /terms|privacy|telehealth-consent/` — three thin
  methods rather than porting Slim's generic template-argument `PageController`, since Nest has no
  equivalent route-argument style and Nest routing wants a real method per path).
- **`views/pages/legal/{terms,privacy,telehealth-consent}.ejs`** — the placeholder copy ported
  verbatim (still not real legal text; every deployment is responsible for its own, exactly as the
  PHP original states).
- **Structured data wired into the 3 pages PHP's own `StructuredData::pathsToInspect()` covers**:
  `HomeController`, `ProductListController` (`/treatments/`), `ProductDetailController`
  (`/products/:slug/`) — each now passes `structured_data: this.structuredData.json(req.path)`.
- **Error pages needed no changes.** They already passed `noindex: true` explicitly and
  `ErrorPresenter` already set `X-Robots-Tag: noindex, nofollow` unconditionally (Phase 1) — header
  and meta tag already agreed; the "lands in Phase 9" note on those views was about moving them into
  a shared funnel layout, which this port's EJS-has-no-inheritance decision (see MERN.md's Templates
  section) already ruled out as a real layout file — every page includes its own head/foot partials
  by design, so there was no separate layout work to do here.
- **The Tailwind v4 asset-build pipeline and client JS, initially deferred, were built later this
  session** (after Phase 10) — see the "Asset pipeline + design pass" section below for the full
  account.

**Proven against a real running server**: `robots.txt` correctly emits a blanket `Disallow: /` plus
a `Sitemap:` line under `discourageIndexing` (dev/test), `sitemap.xml` serves a well-formed but
empty `<urlset>` so the two documents never contradict each other, all 3 legal pages render with
matching header/meta-tag `noindex`, and the home page's `<script type="application/ld+json">` holds
a real `Organization`/`WebSite` graph built from actual config values (site name, description,
canonical URLs, the configured search endpoint) — not a stub.

---

## Asset pipeline + design pass (done, post-Phase 10)

The Tailwind v4 build pipeline and client JS, deferred out of Phase 9, plus a design pass bringing
the marketing/storefront pages up to the reference design mockup at `docs/mockup/mockup/` (the
original static HTML/Tailwind-CDN/vanilla-JS design source storefront-lamp's own theme was itself
ported from — `storefront-lamp/CLAUDE.local.md` documents that provenance).

- **`public/css/app.css`**, **`public/js/*.js`** (`cart.js`, `checkout.js`, `datepicker.js`,
  `intake-engine.js`, `intake.js`, `livereload.js`, `script.js`, `upsell.js`,
  `vendor/lucide.min.js`) — copied from storefront-lamp's `theme/css/app.css`/`theme/js/*.js`
  (already Tailwind-v4-ready and, per that repo's own `script.js` doc comment, "the mockup's script
  unmodified" apart from the cart's server-owned-state changes) with one path fix: `app.css`'s
  `@source` directives now point at `../../views` (this port's EJS templates) instead of
  `theme/templates` (Twig). No other changes were needed — route paths, DOM ids/classes, and the
  `_csrf` field name all already matched this port's real implementation by construction.
- **`build/build-assets.mjs`** / **`build/watch.mjs`** — ported from storefront-lamp's own build
  scripts, paths adjusted for this port's `public/css`/`public/js` → `public/assets/build` layout;
  `tailwindcss`/`@tailwindcss/cli` added as devDependencies (`^4.3.3`, the real latest stable —
  `npm view tailwindcss dist-tags` checked first per `CLAUDE.local.md`'s pre-release trap).
- **A real, previously-invisible gap found and fixed**: `src/main.ts` never called
  `app.useStaticAssets(...)` at all — nothing served `public/assets/**` over HTTP, so even a
  correctly-built CSS/JS bundle would have 404'd. Fixed by serving `public/assets` at `/assets`
  specifically (not the whole `public/` dir — `public/css`/`public/js` are build *input*, kept
  unserved, the same way storefront-lamp's `theme/` sits outside its `public/` document root).
- **Static assets populated for the first time**: fonts (`public/assets/fonts/*.woff2`, copied from
  storefront-lamp), marketing images (`public/assets/img/*`, identical to the mockup's own
  `assets/images/`), and catalog product photos (`public/assets/media/*` — real photos for the two
  products whose slugs match the mockup's designed lineup, `semaglutide`/`finasteride`; an honest
  `product-placeholder.svg` for the rest, since this port's example catalog is invented data with no
  corresponding mockup photo, and fabricating one would be worse than a plain placeholder).
- **Pages rebuilt against the mockup's actual markup** (user decision: full rebuild, not just a
  stylesheet over the old thin markup): `home.ejs` (79 lines → the mockup's full hero / promo
  banner / real "Our Treatments" card grid over live catalog data / How It Works / Why Choose Us /
  testimonials carousel / FAQ accordion / CTA), `treatments.ejs` (page header, sidebar
  category/type filters, rich card grid), `product.ejs` (breadcrumb, sticky gallery with
  thumbnails, badges, treatment-plan selector, product FAQ accordion, How Your Treatment Works),
  `not-eligible.ejs` (added the mockup's "Next Steps & Alternatives" panel and gave "Browse Other
  Treatments" real button weight when there's no verdict to react to).
- **Found already correct, not rebuilt**: `checkout.ejs`, `upsell.ejs`, `thank-you.ejs` each
  already carried a doc comment stating they were "styled per docs/mockup/mockup/intake/*.html" —
  verified by screenshot (a real cart pushed through `/checkout/`) rather than assumed, and the
  claim held: two-column contact/delivery/payment form, sticky order summary with real cart lines,
  consent checkboxes wired to the real terms/privacy/telehealth links, all rendering correctly the
  moment the CSS pipeline existed. `verify.ejs` (unreachable in this build — `verification.enabled`
  is `false` — see the Real EMR integration section above) was left as its simpler, still
  token-consistent original.
- **A real bug in `config/products.generated.ts`'s price display, caught by the existing test
  suite, not introduced by it**: the home page's "Our Treatments" cards originally read each
  product's own `price_unit` (`'/ month'` in this config), diverging from
  `test/routes/catalog-pages.e2e-spec.ts`'s pinned `'$299.00/mo'` expectation, which encodes the
  mockup's actual fixed "Starting from $X/mo" copy (never a per-product unit). Fixed by hardcoding
  `/mo` on that one card, matching the mockup and the pre-existing test exactly.
- **Verified visually, not just by status code**: Playwright (via the system's installed Chrome,
  `channel: 'chrome'` — no sandboxed browser download available) screenshotted home, treatments,
  product, checkout (with a real cart pushed through a live browser session), and not-eligible
  against the running dev server.
- **A process lesson worth keeping**: `AssetManifest` caches its resolved hash map in-process for
  the life of the server (correct for production, where a deploy always restarts the process after
  `npm run build:assets`). During iterative template/CSS work against one long-running dev server,
  this means **the server must be restarted after every `build:assets` run**, or it keeps serving
  stale hashed filenames that `build-assets.mjs` has already deleted — this produced a real,
  confusing "page has no styling" regression mid-session that was a stale-cache artifact, not a
  template bug. Restarting the dev server via the harness's own background-task management
  (`run_in_background`, not a manually-backgrounded shell job) is also required — a `nohup ... &`
  inside a single tool call does not survive to the next tool call in this environment.

**Not done, deliberately, and separate follow-up work**: the field-type intake questionnaire
partials Phase 6 already flagged as thin (`pages/intake/{form,form-js-engine}.ejs` and ~15
`partials/intake/field-*.ejs` files) — this remains a Phase 6 gap, not an asset-pipeline gap, since
these pages currently always degrade to `form-unavailable.ejs` in this environment regardless of
their own styling (no live channel teleform to render against).

---

## Phase 10 — Remaining console commands + observability (done)

Ported from literal verbatim source: all 12 `core/Console/*.php` command files, the Abandonment
domain (`AbandonmentState`/`AbandonmentClassifier`/`AbandonmentSignal`/`AbandonmentSweep`), the
Retention domain (`RetentionPolicy`/`RetentionSweep`/`LogSweep`/`LogDirectoryUnreadable`), the
Reconciliation domain (`ForwardReconciliation`/`ReconciliationReport`/`ReverseReconciliation`/
`ReverseReconciliationReport`), `Instrumentation.php` and its 7 decorator classes, `config/
abandonment.php`, `config/retention.php`.

- **Observability wired into real DI, not just built and left standing.** `src/observability/
  instrumentation.ts` is the thin `Instrumentation` factory (7 methods, one per port, each `new`ing
  the matching `Instrumented*` decorator around `BoundaryTimer`). `core.module.ts` now wraps
  `SESSION_GATEWAY`/`CART_GATEWAY`/`TELEFORM_GATEWAY`/`LEAD_GATEWAY` on their real (`Emr*`) branch
  only — Null bypasses instrumentation, matching `AppFactory.php` exactly — and wraps
  `PAYMENT_ADAPTER`/`CHECKOUT_EVENT_REPORTER` **unconditionally**, since PHP wraps whatever
  `AdapterRegistry`/`EmrCheckoutEventReporter` resolves to, Null included. `INTAKE_GATEWAY` keeps
  its existing `RecordingIntakeGateway` outer wrap, with the inner Emr-or-Null choice instrumented
  only on the Emr side.
- **A real, previously-invisible bug found and fixed while exercising this wiring for the first
  time**: `OperationalCounts.checkoutsWithoutEmrSession()` filtered on `sessionUuid: '' OR
  sessionUuid: null`, but `events.session_uuid` is `NOT NULL` in this port's schema (unlike a
  hypothetical nullable column) — Prisma's query validator rejects a `null` literal against a
  non-nullable field outright, throwing `PrismaClientValidationError` on every call. Silent under
  every earlier test (nothing had exercised this specific method yet) and only surfaced running
  `ops:status` for real against the dev database. Fixed by dropping the dead `null` branch — the
  method's own doc comment already said the column was `NOT NULL`; the code just hadn't followed it.
- **`src/abandonment/`**: `abandonment-state.ts` (a `Boundary`-style class of named string
  constants + `depth()`, the *deepest-evidence-wins* ordinal `AbandonmentClassifier` reads),
  `abandonment-classifier.ts` (pure, stateless — `isComplete()`/`isDisqualified()` short-circuit to
  `null` before the ladder runs; a placed order settles every rung below the upsell), `abandonment-
  signal.ts` (the wire document — no clinical content, ever), `abandonment-sweep.ts` (`@Injectable`,
  reads `config.abandonment`/`config.app.url`/`config.app.session.resumeParam`, writes the `[30.7]`
  access-audit row on every emitted signal via `EventRepository.append()`, which itself swallows
  failures).
- **`src/retention/`**: `retention-policy.ts` (`RECONCILIATION_FLOOR_SECONDS = 172_800`, a *floor*
  clamped via string comparison on fixed-width ISO timestamps, exactly like the PHP original's
  `gmdate('c')` lexicographic trick), `log-sweep.ts` (Node `fs`, mtime-based, a missing directory is
  zero-and-fine while an unlistable one throws `LogDirectoryUnreadable`), `retention-sweep.ts`
  (Prisma **relation filters** — `orders: { none: {} } `/`{ some: {} }` — replacing the PHP
  original's raw `NOT IN (SELECT ...)` subquery; a relation only forms for a non-null
  `sessionUuid`, so this sidesteps the classic "`NULL` inside `NOT IN` makes the whole comparison
  unknown" trap without needing the PHP original's explicit `IS NOT NULL` guard at all).
- **`src/reconciliation/`**: `forward-reconciliation.ts`/`reconciliation-report.ts` (real —
  `OrderRepository`/`CHECKOUT_EVENT_REPORTER` are both real ports in this environment, so this
  class runs its actual logic, not a stub), `reverse-reconciliation.ts`/`reverse-reconciliation-
  report.ts` (real logic, but `PAYMENT_ADAPTER` resolves to `NullPaymentAdapter` with
  `supportsOrderSearch: false` in this whole port, so `run()` always takes the honest "unsupported"
  branch — proven, not assumed, in `test/phase10-sweeps.spec.ts`'s call through `ops:status
  --provider`).
- **Repository additions** (deferred from Phase 7 for exactly this reason, per that code's own doc
  comments): `SessionRepository.findLastMovedBetween()`; `OrderRepository.findUnsyncedPlacedBefore
  ()`/`markTreatmentSynced()`/`countUnsynced()`/`countUnsyncedPlacedBefore()`/
  `countUnsyncedWithoutSession()`; `CheckoutAttemptRepository.expire()`/`countExpirable()`/
  `countUnresolved()` (+ private `replaceableCompletionKeys()` — an aged `complete` row is deletable
  only if its stored outcome decodes and isn't `PENDING_ACTION`; an undecodable outcome counts as a
  live challenge and is kept, fail-closed); `RateLimitRepository.expire()`/`countExpirable()`.
- **All 12 console commands, `npm run console -- <name>`**:
  - **Real, DB-driven**: `abandonment:signals` (JSON to stdout, failures to stderr so a JSON
    consumer never chokes on an error line), `db:prune` (dry-run by default, `--apply`/`--dry-run`,
    never deletes a `sent` checkout attempt or an order-referenced session at any age),
    `emr:reconcile`/`provider:reconcile` (the two sweeps above, from a terminal), `ops:status`
    (`[20.12]`'s monitored counts in one place — the `Measured`/`DeclineBreakdown` three/four-state
    figures from earlier this phase now actually consumed, not just built).
  - **Real, no DB**: `emr:ping` (fetches the real dev-sandbox channel via `EmrClientFactory` —
    proven against the live channel: `Channel: CheckoutChamp SA`, `Products: 1`,
    `Provider: checkout_champ`), `provider:ping` (calls the real, injected `PAYMENT_ADAPTER` —
    honestly reports the Null adapter as not-ok), `cache:clear` (wipes `storage/cache/`, exits 1 if
    anything survives), `forms:cache-purge` (calls Phase 6's `DefinitionCache.purge()`),
    `config:validate` — **deliberately scoped**, not the full ~1100-line PHP port: this port's
    `config/*.ts` files are TypeScript modules `npm run typecheck` already refuses to compile wrong
    (a whole class of the PHP original's "wrong type in this array key" checks is therefore enforced
    by the compiler, not this command), and several PHP checks depend on infrastructure this port
    doesn't have (`channel.generated.php`, payment-required-key introspection tied to real
    deployment credentials, consent-link reachability against a route table only introspectable
    inside a booted HTTP server). What it does check, for real: `app.debug.wireLog` left on;
    `abandonment.*`'s four numbers and its `marketingConsentKey` cross-reference into
    `consent.consents`; `verification.*`'s placement/checks shape, when the step is enabled;
    `app.portal.url` (warning only). Exit code 2 (not 1) on any error, matching the PHP original.
  - **Honest no-ops, not stubs pretending to be real**: `theme:sync`/`media:prune` both print
    plainly that this port has no `CatalogBuilder`/`MediaLocalizer`/generated-config-writer
    pipeline — building one is a separate, large piece of follow-up work on the same scale as the
    Phase 9 asset pipeline, not Phase 10 (console commands + observability) scope. Flagged
    explicitly rather than left silently unbuilt or faked.
- **Tests**: `test/abandonment/abandonment-classifier.spec.ts` (12 cases — every rung, the
  deepest-wins ladder under simultaneous evidence, both `isComplete()`/`isDisqualified()` guards,
  both placed-order branches), `test/retention/retention-policy.spec.ts` (cutoff math, the
  zero-disables-expiry case, the reconciliation floor clamp, the log cutoff's deliberate *non*-floor),
  `test/observability/instrumentation.spec.ts` (proves `Instrumentation.leadGateway()` wrapping
  `NullLeadGateway` still produces a log line — the "Done" bar for the whole observability layer:
  the wrapper observes the call, not the wrapped Null's own behavior), `test/phase10-
  sweeps.spec.ts` (a real temp-file SQLite DB, seeded fixtures, exercising `AbandonmentSweep`/
  `RetentionSweep`/`ForwardReconciliation`/`OperationalCounts` for exact counts — including the
  disjoint backlog-vs-unreconcilable split and the never-expire-an-order-referenced-session
  guarantee).
- **Two scope questions flagged, not silently resolved**: `payment:capture`/`forms:record` exist in
  the PHP original but are named nowhere in the plan — treated as out of scope, matching plan
  silence, but never explicitly confirmed with the user. Whether `theme:sync` should eventually get
  real `CatalogBuilder`/`MediaLocalizer` infrastructure (vs. staying the honest no-op above) is an
  open follow-up, same scale as the deferred asset pipeline.

---

## Test status

`npm run typecheck` ✅ · `npm run lint` ✅ · `npm test` — **329/329 passing**, 49 suites (up from
114/17 at the end of Phase 6, 128/19 at the end of Phase 7, 131/21 at the end of Phase 8, 161/26 at
the end of Phase 9, 186/30 after the asset pipeline + intake-stepping fix, 229/35 after
`payment:capture`/`forms:record`/real catalog-sync, 314/46 after the real Vrio/CheckoutChamp
adapters). No test reaches the
network (every EMR-family port forced Null under `NODE_ENV=test`, verified directly);
`test/database.spec.ts`, `test/routes/checkout-to-receipt.e2e-spec.ts`,
`test/phase10-sweeps.spec.ts` and `test/console/capture-order.command.spec.ts` each need a fresh,
ad-hoc `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` per session (Prisma 7's AI-agent safety guard
on `db push --accept-data-loss`) — never baked into a checked-in file, see `CLAUDE.local.md`.

---

## `payment:capture` / `forms:record` / real catalog-sync infrastructure (done, post-Phase 10)

The two Phase 10 scope questions flagged earlier — resolved by explicit user decision this
session — plus real `theme:sync`/`media:prune`, replacing their honest-no-op placeholders.

- **`payment:capture <reference>`** (`src/console/capture-order.command.ts`) — settles an order
  that was authorized rather than charged. Ported field-for-field from `CaptureOrderCommand.php`,
  including its one genuinely unusual property: **it never writes back to the local `orders` row
  on success** — all state after a real capture lives only in the provider's own record, matching
  the PHP original exactly (confirmed against its own test suite, which asserts the same). Order
  lines are rebuilt from the local `order_lines` table rather than read back from the provider,
  since at least one real provider holds an empty item list on a pre-authorized order until the
  settling call supplies it. Six unit tests (`test/console/capture-order.command.spec.ts`) mirror
  the PHP original's own test scenarios exactly: missing reference, no local order, an order
  recorded as `capture` not `authorize`, an adapter without `supportsAuthorizeCapture`, a
  successful capture, and a provider refusal — each asserted by exit code, against a real temp
  SQLite DB and a stub `PaymentAdapter`.
- **`forms:record --teleform=<id> [--out=<dir>]`** (`src/console/forms-record.command.ts`) — a
  developer/operator recording tool, unrelated to `IntakeSession` machinery: given a teleform id,
  reads through `TeleformGateway` directly (bypassing `TeleformSource`'s definition cache
  deliberately, so a recording captures what the EMR is serving right now, not what the storefront
  happens to have cached) and writes two JSON files — the reduced metadata record and the raw
  definition document — so a republished form or an unanticipated envelope shape can be recaptured
  as a test fixture with one command. **Verified against the real dev-sandbox EMR**: correctly
  reports "No teleform metadata" for this port's example teleform ids, the same honest degrade
  proven end-to-end in Phase 6.
- **Real catalog-sync infrastructure** — `src/catalog/catalog-builder.ts` (`CatalogBuilder`, ported
  from `CatalogBuilder.php`: the visibility gate, the `rx`/`otc`/`lab`/`free-addon` kind decision,
  slug generation, single-SKU variant synthesis, first-match-wins provider-mapping resolution,
  nested labtest/add-on dedup, and the slug-collision hard error — 13 unit tests,
  `test/catalog/catalog-builder.spec.ts`), `src/catalog/media-localizer.ts` (`MediaLocalizer`,
  using Node's global `fetch` in place of the PHP original's PSR-18 client — the same
  content-hashed-filename/failure-fallback-ladder/`findOrphans()` logic, shared by `theme:sync`'s
  own localization pass and `media:prune`), `src/catalog/catalog-validator.ts` (`CatalogValidator`
  — the structural pass `theme:sync --apply` and `config:validate` both could run; 11 tests),
  `src/catalog/generated-config-writer.ts` (`GeneratedConfigWriter` — the merge-not-replace
  semantics for `channel.generated.ts`, ported from the logic embedded in PHP's `SyncCommand.php`
  rather than in `PhpArrayExporter`, which is a pure renderer/differ; 8 tests covering the
  full-replace-on-different-channel case, the keep-hand-added-keys case, and the
  always-replace-`payment_processor` case).
- **A deliberate rendering divergence from `PhpArrayExporter`**: this port's generated files are
  TypeScript modules, not PHP array literals, and `JSON.stringify(value, null, 2)` is already valid
  TypeScript object-literal syntax — there is no PHP `serialize_precision`/list-vs-map distinction
  to reproduce, so no unified-diff convenience is produced either; a dry run instead reports
  would-change booleans and the counts an operator needs to decide whether to `--apply`.
- **`theme-sync.command.ts` rewritten for real**: fetches the configured channel via the real,
  already-live `EmrClientFactory`, builds the catalog, and (in `--apply` only) localizes images and
  writes `config/products.generated.ts` (overwritten wholesale every sync) and
  `config/channel.generated.ts` (merged). **`config/products.generated.example.ts` created** as the
  permanent, never-overwritten shape reference the original hand-written example data started
  from — mirroring PHP's own `products.generated.example.php` convention, now that `--apply` can
  really overwrite the live file. Exit code 2 (not 1) on a post-write validation error, matching
  the PHP original. **Rebuild-to-take-effect is explicit and unavoidable**: both generated files
  are TypeScript source resolved at `nest build` time, not `require`-style-fresh-per-request the
  way PHP's originals were — documented in both files' own headers.
- **`media-prune.command.ts` rewritten for real**: lists (or, with `--force`, deletes) files under
  `public/assets/media` whose slug prefix matches no current catalog product, via the same
  `MediaLocalizer.findOrphans()` `theme:sync` itself uses, so both agree on exactly what counts as
  an orphan.
- **Proven against the real dev-sandbox EMR channel, not just unit-tested**: `theme:sync` (dry
  run) correctly reports 2 real products, 1 image pending localization, and 1 variant missing a
  provider mapping from the live "CheckoutChamp SA" channel — without touching the committed
  example catalog (confirmed unchanged after the run).
- **A real, previously-invisible bug found and fixed while proving `media:prune` against this
  port's own example catalog**: the product photos set up during the earlier asset-pipeline work
  were named `semaglutide.png`, `finasteride.png`, etc. — not slug-prefixed
  (`aa1111-semaglutide.png`) — so `findOrphans()`'s "slug prefix before the first `.`" predicate
  correctly, if unhelpfully, flagged every one of them as orphaned. Fixed by renaming the files to
  their real catalog slugs and updating `config/products.generated.ts`'s `image`/`gallery` paths to
  match; `media:prune` now reports zero orphans against this port's own catalog, as it should.

---

## Real Vrio + CheckoutChamp payment integration (done, post-Phase 10, user-directed)

The Context section's Null-only decision for `PaymentAdapter` is now **reversed for real**,
mirroring the earlier post-Phase-5 EMR reversal. Trigger: the user pointed out that PHP's own
Vrio/CheckoutChamp calls aren't hand-rolled HTTP either — `storefront-lamp/composer.json` requires
`astermd/vrio-client` and `astermd/checkoutchamp-client`, both unofficial third-party packages
published by the same author as `astermd/sdk` (the EMR SDK). Checking npm turned up exact
siblings — `@astermd-hq/vrio-client` and `@astermd-hq/checkoutchamp-client`, same publisher, same
`0.0.1` version, same "unofficial" framing — so this port now wraps those instead of hand-rolling
an HTTP client, exactly matching the EMR precedent (`@astermd-hq/sdk`).

- **Credentials are not static secrets.** Both providers' `api_key`/`api_username`+`api_password`/
  `api_endpoint` live in the synced channel's `payment_processor.config` block
  (`config/channel.generated.ts`, written by `theme:sync --apply`) — confirmed against PHP's own
  `VrioCredentials::fromChannelConfig()`/`CheckoutChampCredentials::fromChannelConfig()` and
  `AppFactory.php`'s registration closures. This is exactly the shape `channel.generated.ts`
  already had from the earlier catalog-sync work, so no new persistence mechanism was needed.
- **`src/payment/vrio/`** (new) — `VrioCredentials` (redacted like `PaymentCredential`/
  `CheckoutChampCredentials`, never serializable), `VrioApiFactory` (wraps `@astermd-hq/vrio-client`'s
  `API`, a fresh client per call, matching the PHP original), `VrioPayload` (order/payment-block
  construction, including the `paymentFor()` short-circuit that refuses a token/order-reference
  credential before ever reaching the wire), `VrioOutcome` (the single most intricate piece of this
  port's payment layer — envelope classification with the stored-credential refusal checked before
  the missing-reference branch, the terminal-status set, the one settlement-dependent branch for a
  null status, 3DS/`response_code: 101` pending-action, and reference/reusable-credential/card-brand
  extraction, all ported from extensive PHP doc comments explaining *why* each branch is ordered the
  way it is), `CardScheme` (Vrio's 4-code card-type mapping, Visa as the fallback), `VrioOffers`
  (the one shared line-builder for both quote and charge — a past PHP bug had two builders drift
  apart), `VrioAttribution` (20 numbered `trackingN` slots), `VrioWireLog`/`RefusingTransport`
  (the wire-log decorator and the test-environment transport substitute, both ported from PHP
  one-for-one), `VrioAdapter` (`capabilities()`/`place()`/`quotePromotion()`/`searchOrders()`/
  `capture()`/`ping()`, category `'vrio'`).
- **`src/payment/checkout-champ/`** (new) — the same shape: `CheckoutChampCredentials` (no
  `campaignId` — campaign is a *per-line* routing hint on this provider, resolved per order),
  `CheckoutChampApiFactory` (wraps `@astermd-hq/checkoutchamp-client`'s `API`),
  `CheckoutChampPayload` (`forLead`/`forOrder`/`forQaApproval`/`forCapture`, one-based
  `productN_id`/`productN_qty`/`productN_price` numbering with no gap for an unmapped line),
  `CheckoutChampOutcome` (the `result`/`SUCCESS`|`ERROR` × `message` string-or-object four-way
  split — a field-validation-map message is never shown to the buyer, only a plain string is),
  `CheckoutChampAuthorizeMode` (`'qa'`/`'preauth'`, parsed leniently but never guessed on a typo),
  `CheckoutChampCardType` (string-keyed brand lookup; the sandbox's `'TESTCARD'` value is
  deliberately not guessed at), `CheckoutChampRefusingTransport`/`CheckoutChampWireLog` (this
  provider's own copies of the same pattern — duplicated per provider because each client declares
  its own `HttpClientInterface`), `CheckoutChampAdapter` (category `'checkout_champ'`; `place()`
  opens a lead via `importLeads` before billing via `importOrder`/`preauth`, `capture()` branches
  entirely differently under `'qa'` mode — settles via `/order/qa/` with no lines at all — versus
  `'preauth'` mode, which resends the order's lines via `/order/import/` and refuses before the
  wire if none are chargeable; `quotePromotion()`/`searchOrders()` are always unsupported, since
  this provider has no discount-quote endpoint and an unverified order-search projection would
  produce false confidence in the reverse-reconciliation sweep).
- **`AdapterRegistry` now genuinely registers both providers** (`core.module.ts`) — previously
  shipped with zero adapters ever registered. Registration mirrors `AppFactory.php`'s own closures
  exactly: each factory is lazy (nothing is read or built until `AdapterRegistry.for()` actually
  resolves that category), and a credentials build failure is caught by the registry itself and
  degrades to `NullPaymentAdapter` with a logged `payment.adapter_build_failed` error — **verified
  live**, not just unit-tested: temporarily pointing `channel.generated.ts` at
  `provider_category: 'vrio'` with no credentials, rebuilding, and running `provider:ping` produced
  exactly that log line and a clean Null fallback, no crash. `PAYMENT_ADAPTER`'s own resolution was
  corrected to match `AppFactory.php`'s fallback chain — `config.payment.adapter ??
  channelGenerated.payment_processor.provider_category` — since it previously only ever read the
  (always-null) config override.
- **Test-environment safety carried over from PHP exactly**: unlike the EMR family, there is no
  Null implementation standing between a test and either live provider — the adapter is chosen from
  synced channel data, never from the environment. Instead, each provider's own
  `RefusingTransport`/`CheckoutChampRefusingTransport` is substituted for the real transport
  whenever `config.app.env === 'test'`, throwing before any request can leave the process; wire
  logging (off by default, `config.app.debug.wireLog`) decorates whichever transport is active
  without changing its behavior on or off.
- **`config/payment.ts` grew two real deployment settings** ported from `config/payment.php`:
  `shippingProfileId` (Vrio-only, required on every payment-carrying order, no home in the EMR
  channel payload) and `checkoutChamp.authorizeMode` (`'qa'`/`'preauth'`, default `'qa'`).
- **85 new tests** (`test/payment/vrio/`, `test/payment/checkout-champ/`) — credentials
  parsing/redaction, `VrioOutcome`/`CheckoutChampOutcome` classification across every recorded PHP
  fixture shape (approved, declined, stored-credential refusal, 3DS pending, terminal status,
  settlement-dependent null status, field-map-vs-string decline message), card-brand mapping,
  payload/offer construction (gap-free numbering, shared quote/charge line builder, campaign
  agreement), and full adapter integration tests driving the **real** npm clients through a fake
  `HttpClientInterface` transport (so the actual envelope-wrapping logic in
  `@astermd-hq/vrio-client`/`@astermd-hq/checkoutchamp-client` runs for real, not mocked away) —
  covering `place()`'s short-circuits (no chargeable lines, unusable credential, unresolved
  campaign, failed lead), both `capture()` mechanisms, and `ping()`.
- **Not built**: real sandbox credentials for either provider don't exist yet in this environment
  (only `CHECKOUTCHAMP_CAMPAIGN_ID` was ever present in `storefront-lamp/.env`, no API keys/
  usernames/passwords for either provider) — so unlike the EMR integration, this could not be
  proven against a live provider, only against the real npm clients with a fake transport. A real
  `theme:sync --apply` against a channel actually configured with one of these providers would
  populate `channel.generated.ts` with real credentials and light the adapter up for real, exactly
  as designed.

---

## Phase 11 — Test suite consolidation (in progress)

Started against the plan's own checklist. An audit pass (a read-only research agent) found the real
gaps first, rather than guessing: `checkout.service.ts` (862 lines, the core checkout orchestrator)
had zero unit tests — only one e2e happy path and a view-model-only render spec touched it at all;
`/intake/*`, `/verify/`, `/not-eligible/` had no HTTP-level test whatsoever, only unit-level tests
of their underlying domain logic; nothing asserted `NODE_ENV=test` actually forces
`session.analytics`/`emrVerification` off; no global "no real network calls" guard existed; 13 of 14
console commands had no test. This pass **prioritized the highest-value gaps** rather than covering
all of them exhaustively in one sitting — see "Deferred" below for what's left.

**This work found and fixed three real, previously-invisible production bugs** — the exact payoff
this phase exists for:

- **Every non-redirect POST response in the app was returning HTTP 201 instead of 200.** Root
  cause: Nest sets a default status code by HTTP method (`201` for `POST`) via
  `RouterExecutionContext.create()`'s `this.responseController.setStatus(res, httpStatusCode)`,
  called **unconditionally before the handler runs — even when the handler injects a raw `@Res()`**
  (which this port's controllers do throughout, by design, for direct `res.render()`/`res.redirect()`
  control). `res.render()`/`res.json()` never touch the status code themselves, so whatever Nest
  pre-set silently survives into the response. `res.redirect(303, ...)` was never affected (Express's
  `redirect()` sets its own status explicitly), which is exactly why this was invisible until a test
  exercised a POST handler's *non-redirect* branch for the first time — every existing e2e test only
  ever exercised the success-and-redirect path. Fixed at each affected call site by setting the
  status explicitly rather than adding a blanket global default (a rate-limited checkout refusal
  still needs its own 429, so the fix has to know *which* status a given branch means):
  `checkout.controller.ts`'s `submit()` (the decline/validation/geo-block re-render branch),
  `verify.controller.ts`'s shared `render()` helper (the held-placement re-render branch), and
  `intake.controller.ts`'s shared `render()`/`unavailable()` helpers and `capture()`'s JSON
  responses. Caught by `test/routes/checkout-submit.e2e-spec.ts`, the first test ever to assert a
  status code on checkout's non-redirect path.
- **`/intake/*`, `/verify/`, `/not-eligible/` had never been proven to work over real HTTP with a
  populated (non-degraded) form before this session** — the shipped example catalog's teleform ids
  don't exist in the real EMR channel, so the live app and every prior test could only ever reach
  `NullTeleformGateway`'s `form-unavailable` degrade. A fixture-backed `TELEFORM_GATEWAY` override
  (`test/support/fake-teleform-gateway.ts`, finalizing the Phase 6-flagged gap) plus a real product
  carrying a `teleform_id` proved the whole render → validate → submit → advance round trip for the
  first time, and along the way caught the 201-status bug above on `/intake/submit`'s own validation
  path too.
- **The first version of this same intake/verify test silently proved nothing**, and would have
  shipped a false-positive test if not caught: it never overrode `DATABASE_CONNECTION` with a real
  migrated database, so it ran against `test/jest.setup.ts`'s default in-memory SQLite — which has
  **no schema at all**. Every `sessions` table write failed, silently, per this codebase's own
  pervasive "a lost write must never become the visitor's problem" design (`[20.1]`) — so
  `JourneyState` was reconstructed fresh, empty, on every single request, and `markFormCompleted()`
  never actually persisted. The test still passed (a valid submit still redirected forward), but for
  the wrong reason: `IntakeController.onward()`'s null-journey fail-forward fallback, not genuine
  funnel routing off a real completed-form flag. Found by writing a *second*, harder test (`/verify/`
  reachable only once `intake_satisfied` is genuinely true) that kept failing until the real cause
  was traced with direct DB inspection — fixed by giving the spec its own `prisma db push`'d temp
  SQLite file, matching `checkout-to-receipt.e2e-spec.ts`'s established pattern. Documented here
  because "the test passed" and "the test proved anything" turned out to be two different claims,
  and the gap between them is exactly what a test audit is supposed to catch.

**Delivered:**
- `test/support/app-config.spec.ts` — asserts `NODE_ENV=test` forces `session.analytics` and
  `features.emrVerification` false directly against the pure `loadAppConfig()` function (Phase 11's
  own literal "done" bar item), plus `seo.discourageIndexing`'s non-production rule for the same
  input space.
- `test/support/no-network.ts`, wired into `test/jest.setup.ts` — a global guard patching `fetch`
  and `node:http`/`node:https`'s `request()` to throw on any non-loopback host. Defense-in-depth,
  not the primary guarantee (every gateway/adapter already refuses the network under
  `NODE_ENV=test` on its own); it exists to turn a *future* test that bypasses one of those seams
  into an immediate, loud failure instead of a real network call or a hang. Verified against the
  full suite (all supertest-driven e2e specs, Prisma's `better-sqlite3` driver) with zero false
  positives — the guard allows loopback traffic unconditionally, which is all any current test
  needs.
- `test/support/fake-teleform-gateway.ts` (finalizes the Phase 6-flagged gap) — a fixture-backed
  `TeleformGateway`, plus `minimalIntakeDefinition()`, a one-page/two-field/one-button fixture
  reusing the exact raw-field shape `test/forms/intake-templates.spec.ts` already proved renders.
- `test/routes/checkout-submit.e2e-spec.ts` (new) — exercises every branch of
  `CheckoutService.submit()` the existing one e2e happy path never reached: field-validation errors,
  missing blocking consent, a geo-blocked line, a provider decline, a `PENDING_ACTION` (3DS-style)
  outcome, and the `checkout.submit` rate limiter actually tripping at its configured limit of 8 —
  isolated from the other tests in the same file via its own `X-Forwarded-For` identity, since the
  limiter's identity is the client address and every supertest request otherwise shares one.
- `test/routes/intake-verify.e2e-spec.ts` (new) — the first HTTP-level test of `/intake/*`,
  `/verify/`, and `/not-eligible/`, against a real migrated temp database and a real minted session
  (`FakeSessionGateway`): renders the real questionnaire, re-renders with a field error, advances on
  a valid submit, reaches `/verify/`'s Null-identity "inconclusive" copy once intake is genuinely
  satisfied, and confirms `/not-eligible/`'s from-anywhere reachability.
- `test/middleware-ordering.e2e-spec.ts` — renamed from `middleware-pipeline.e2e-spec.ts` to the
  plan's canonical Phase 11 filename (same content). Deliberately does **not** add a Set-Cookie
  ordering test for "a simulated retire+re-mint in one request" (Phase 2's original done-bar
  wording) — traced and documented in the file's own header as a scenario this port's current,
  intentionally-reduced `SessionResolver` cannot actually reach yet (no code path re-mints a session
  that already carries a `sessionRetired` cookie), not merely one nobody wrote a test for. The
  ordering *invariant* itself stays structurally locked down by the existing 9-slot order assertion
  plus `RetiredSessionMiddleware`'s own `writeHead`-patching design.

**Deferred, explicitly, to keep this pass scoped** (not started this session):
- Unit specs for `checkout.service.ts` itself and its smaller under-tested siblings
  (`buyer-validator.ts`, `idempotency-key.ts`, `settlement-policy.ts`, `post-charge-guard.ts`,
  `checkout-attempt.ts`, `database-order-recorder.ts`, `order-bumps.ts`, `prefill.ts`,
  `card-number.ts`) — `checkout.service.ts`'s ~20 constructor dependencies make a direct unit spec
  expensive to build correctly; the new `checkout-submit.e2e-spec.ts` covers its behavior
  end-to-end instead, which is real coverage but not the module-scoped seam the plan asks for.
- 13 of 14 console commands still have no test (`payment:capture` is the only one that does).
- `test/support/fake-teleform-gateway.ts`/`fake-session-gateway.ts` are separate files rather than
  a single `app-factory.ts` (the plan's named file); `test/support/test-app.ts`'s `createTestApp()`
  already serves that role under a different name and is reused everywhere — a rename would be
  pure churn, not a functional gap.
- No `cookie-jar.ts` helper — audited and found nothing to de-duplicate: every e2e spec already
  uses `supertest`'s own `request.agent()`, which transparently persists cookies across requests.
  If this is still wanted, its actual job would have to be asserting raw `Set-Cookie` attributes
  (Secure/HttpOnly/SameSite/Max-Age), not general cross-request cookie carrying.
- `abandonment-signal.ts`, `retention/log-sweep.ts`/`log-directory-unreadable.ts`,
  `reconciliation/reverse-reconciliation.ts`/`reverse-reconciliation-report.ts`/
  `reconciliation-report.ts`, and every `src/emr/*` gateway/client class (all exercised only
  indirectly, none Null-bound-and-forgotten) — untested but lower-severity than the checkout gap.

---

## First real theme:sync --apply, and four real bugs it surfaced (post-Phase 11, live-verified)

The user ran `theme:sync --apply` for real against the live "CheckoutChamp SA" dev-sandbox channel
— the first time this port's own catalog/credentials were ever synced for real, rather than only
dry-run-checked. It worked: `config/channel.generated.ts` now carries real CheckoutChamp credentials
(`provider_category: "checkout_champ"`, real `api_username`/`api_password`), and
`config/products.generated.ts` now carries the channel's 2 real products ("Rameltion", an Rx sleep
medication with a real teleform; "liver function tests", a bundled lab with no payment mapping yet).

**A real credential-leak risk was found and fixed first.** `config/channel.generated.ts` is tracked
by git (unlike `.env`) with a real GitHub remote configured (`github.com/astermd/storefront-node-temp.git`)
— nothing had been pushed yet (the committed version still held the original null-placeholder
shape), but the real secret now sitting in the working tree was one `git add .` away from landing in
history. Fixed: added the file to `.gitignore` (matching storefront-lamp's own
`channel.generated.php` convention exactly, and correcting this file's own header comment, which
had claimed no `.gitignore` enforcement existed) and `git rm --cached` to untrack it — left staged,
not committed, for the user to commit when ready.

**Driving the real synced catalog through a real browser-equivalent flow (curl, but exactly
replicating what `intake.js`'s own `fetch`/`FormData` calls send) found four real, previously-
invisible bugs**, none of them related to the sync itself — they were always there, just never
exercised by anything that reached this deep into a real, populated questionnaire before:

1. **Every non-redirect POST response was HTTP 201, not 200.** Same root cause as the checkout/
   verify/intake fix documented in Phase 11 above — this is where it was first noticed, on
   `/intake/medical/`.
2. **`views/partials/intake/field-textarea.ejs` didn't exist.** `textarea` is a real, listed
   `FieldTypes::VALUE_TYPES` entry in the PHP original, and this port's own Phase 6 build (18
   field-type partials) simply never produced a file for it — no example-catalog teleform had ever
   contained one to catch the gap. Rameltion's real questionnaire has four. Fixed by porting
   `field-textarea.twig` faithfully (a real `<textarea rows="4">`, not a text-input alias). Locked
   down in `test/forms/intake-templates.spec.ts`.
3. **The entire real-browser intake flow (progressive save, early lead capture, and — this is the
   serious part — the actual final Submit button) was silently broken by a CSRF/body-parsing
   mismatch.** `intake.js`'s `post()` helper sends every one of its calls as a `fetch` with a
   `FormData` body, which browsers always encode as `multipart/form-data` regardless of the HTML
   `<form>`'s own `enctype` — and this app parses no multipart body anywhere (no `multer`/equivalent
   was ever wired up), so `req.body` was `undefined` for every one of these calls, `_csrf` never
   reached the server, and `CsrfMiddleware` correctly rejected every one with 419. `save()`'s and
   `attemptCapture()`'s `.catch()` handlers silently swallowed the failure; `submit()`'s handler
   treated the non-redirected 419 response as "the server refused and re-rendered" and called
   `window.location.reload()` — so a real visitor clicking Submit saw the page reload with no
   explanation, forever, never actually completing a questionnaire through the UI. Confirmed via a
   multipart curl request carrying the genuinely correct token, which still 419'd until fixed.
   Fixed two ways, both needed together: `intake.js`'s `post()` now sends the token as an
   `X-CSRF-Token` header (which `CsrfMiddleware` already accepted — it just had nothing populating
   `req.body` to fall back from), and `IntakeController`'s `save()`/`submit()`/`capture()` handlers
   gained `@UseInterceptors(AnyFilesInterceptor())` so `req.body`'s ordinary fields actually get
   parsed out of the multipart body at all. Neither fix alone was sufficient.
4. **Real file-upload support, built for the first time.** Rameltion's real questionnaire has three
   `file-upload` fields (photo/document follow-ups on medication, injury, and B-12 questions) — a
   type PHP's own `FieldTypes.php` has no equivalent for at all (confirmed: PHP never wired this up,
   this isn't a port gap). `@astermd-hq/sdk` genuinely supports it
   (`intakeSubmissions().uploadFile()`/`FileUpload.fromContents()`), so this port implements it for
   real rather than permanently refusing any questionnaire that asks for a document — a deliberate,
   documented MERN-only capability (see `field-types.ts`'s doc comment on `file-upload`). Built:
   `IntakeGateway.uploadFile()` (+ `Emr`/`Null`/`Recording`/`Instrumented` implementations — the SDK
   response's reference key isn't typed, confirmed against the real server to be `path`, not
   `reference`/`url`/`id` as first guessed), `IntakeSession.uploadFile()`, a new
   `POST /intake/upload` endpoint (`FileInterceptor`, `memoryStorage()`, 10 MB cap), a new
   `field-file-upload.ejs` partial (the visible `<input type="file">` carries no answer itself —
   the hidden reference input next to it does, filled in by `intake.js` once the upload completes),
   and `intake.js`'s own upload handler (uploads on `change`, using the same `X-CSRF-Token` fix from
   #3). `@types/multer` added as a dev dependency for `Express.Multer.File`'s type only — no other
   new runtime dependency. **Verified against the real dev-sandbox, not just unit-tested**: a real
   text file uploaded through `POST /intake/upload` came back with a genuine stored path
   (`.../intake_submissions/<session>/test-id-<uuid>.txt`), and the full 49-field real Rameltion
   questionnaire renders with zero unsupported-type refusals for the first time. Full end-to-end
   completion (every one of the ~14 genuinely-required real fields correctly filled, submitted, and
   redirected onward) was not chased to completion in this session — verified instead that real
   server-side validation correctly rejects an incomplete submission with the exact real question
   text for each missing answer, which is what proves the validation and rendering pipeline is
   sound; getting the very last field or two exactly right is a data-entry completeness task, not a
   code-correctness one, and is left open.

Test suite: 332/332 passing (up from 329), `npm run typecheck`/`npm run lint`/`npm run build` all
clean, dev server reboot-verified.

---

## `public/assets/build/` is now gitignored, built at deploy time (user-directed reversal)

While reviewing `.gitkeep` files, the user asked why `public/assets/build/` (the content-hashed
CSS/JS output) wasn't gitignored — it wasn't an oversight, `MERN.md` had documented committing it as
a deliberate, verbatim carry-over of storefront-lamp's own convention (PHP's deployment model never
runs Node on the server at all, so the build has to happen before commit, not after deploy). The
user asked to change this to the standard Node convention instead: gitignored, built when the
process starts.

- `public/assets/build/` added to `.gitignore`; the 12 previously-tracked files there (including its
  now-redundant `.gitkeep` — `build-assets.mjs` already `mkdirSync`s the directory itself) untracked
  via `git rm --cached`, left in place on disk.
- Also removed as redundant, same reasoning: `public/css/.gitkeep` and `public/js/.gitkeep` — both
  directories have real, already-tracked source files, so git already keeps them without a
  placeholder. `storage/{sessions,logs,database}/.gitkeep` and `test/fixtures/.gitkeep` were left
  alone — those directories are genuinely empty of tracked content.
- **No CI/CD pipeline exists in this repository yet**, so "build at deploy time" needed a concrete
  mechanism rather than just a policy: `package.json` gained a `prestart` script
  (`npm run build && npm run build:assets`, npm's own auto-run-before-`start` convention) and a
  `preconsole` script (`npm run build`), so a bare `npm start`/`npm run console -- <cmd>` on a fresh
  checkout with no prior build produces a fully working app or command with no manual step. Verified
  directly: `rm -rf dist && npm run console -- config:validate` succeeded, with the `preconsole`
  hook visibly rebuilding first.
- `MERN.md` updated in two places to match (its Layout section's tree, plus a new paragraph
  explaining the reversal and its reasoning; its Operational traps section, whose old "run
  `build:assets` last, before committing" guidance no longer applies) — this session's standing rule
  for every stack-override decision, so the doc doesn't drift stale against what the code actually
  does now.

---

## A fifth real bug: authored intake buttons were completely inert (found via real browser use)

The user reported, from an actual browser screenshot of the real live Rameltion questionnaire, that
the "NEXT" button did nothing when clicked after answering the page's question — every prior
verification of this session's intake work had been curl-only (raw HTTP, no JS execution), which is
exactly why this had never been caught. Driven with Playwright against real Chrome
(`channel: 'chrome'`) instead of curl for the first time this session, per the project's own "start
the dev server and use the feature in a browser" rule for UI work.

**Root cause**: `views/partials/intake/field-button.ejs` rendered `data-button-action="<%= f.button_action %>"`
— not `data-intake-action`, the one and only attribute name `public/js/intake.js`'s click handler
actually queries for (`event.target.closest('[data-intake-action]')`), and the same name
`pages/intake/form.ejs`'s own shared nav buttons correctly use. The file's own leftover comment
even said as much: "multi-page client-side stepping isn't wired up yet" — true when it was written,
never revisited when the rest of the intake templates were wired to this exact contract earlier in
this session. It stayed invisible because `pages/intake/form.ejs` **hides its shared nav entirely**
whenever the definition's own pages carry authored buttons (`definition_has_buttons`, `[10.10]`:
"the author's choice wins") — and Rameltion's real questionnaire authors a `button` field on every
one of its pages. So the only Continue/Next/Submit controls on screen were the authored ones, and
none of them were wired to anything: clicking did nothing, silently, with no error anywhere (a plain
`type="button"` with no click handler and no native form-submit behavior just consumes the click).

Ported `field-button.twig` properly this time — `data-intake-action` (not `-button-action`),
`type="submit"` + `name="intake_submit" value="1"` only for the `submit` action (matching the shared
nav's own `name="intake_next" value="1"` convention on its Continue button, and PHP's original
exactly), and the previous-page/else class split PHP's version has and this port's didn't (a
`previous_page` authored button was rendering with the *primary* filled style instead of the
outlined "Back" one — a real, if purely cosmetic, second bug in the same file).

**Verified live, not just re-rendered**: Playwright confirmed the real "Continue" button went from
`visible: false` (zero bounding box — genuinely not clickable, not merely "looked disabled") to
`visible: true`, and clicking it now genuinely advances `data-intake-page-input` from `0` to `1`,
against the real Rameltion questionnaire. Locked down in `test/forms/intake-templates.spec.ts`,
whose own button fixture had existed since Phase 6 without ever asserting the attribute name — the
gap that let this ship unnoticed in the first place.

Test suite: still 332/332 (an EJS-only fix), `npm run typecheck`/`npm run lint` clean.

---

## Next/Submit now disables until the current page's required fields are answered (UX, user-directed)

Following the button-attribute fix above, the user asked for a specific UX behavior `intake.js`
never implemented: the Next/Submit button should be disabled until every required field on the
*current* page has a valid answer, then enable — not always-clickable-but-validated-at-click-time,
which is what the port had (matching the PHP original's own design, but the user wanted the port to
do more here).

- `public/js/intake.js` gained `pageAnswered(page)` — the same `[required]`/`checkValidity()` walk
  `validatePage()` already does, factored out so both share one definition of "answered", but
  without `validatePage()`'s side effect of showing/clearing error messages (this runs on every
  keystroke to gate the button, not just at a submit attempt).
- `checkTermination()` (called on every `input`/`change`, already the place `setAdvanceEnabled()`
  was driven from for the terminated/blocked cases) now also gates on `pageAnswered(pages[current])`.
- `goToPage()` now calls `applyConditions()` on entry to a page. Without this, arriving on a new
  page via a Next/Back click — which calls `goToPage()` directly, not through an `input`/`change`
  event — would leave the button showing whatever enabled state the *previous* page left it in,
  until the visitor touched something on the new one; confirmed as a real gap while building this,
  not just a theoretical one.
- **Verified live end to end against the real Rameltion questionnaire**, the same way the button-fix
  above was: `disabled: true` before selecting an answer, `disabled: false` immediately after,
  click genuinely advances the page, and the *newly arrived* page's own button correctly starts
  `disabled: true` again before anything on it is answered.
- Known, accepted limitation carried over from the button-attribute fix's own investigation, not
  newly introduced here: a `file-upload` field's `required` marker sits on the hidden reference
  input (see `field-file-upload.ejs`), and the HTML5 spec excludes `type="hidden"` from constraint
  validation entirely — `checkValidity()` on it always returns `true` regardless of value, so a
  required-but-unanswered upload does not hold the button disabled client-side. Server-side
  validation (`AnswerValidator`) still catches it correctly on submit either way.

Test suite: 332/332 (another JS-only change), `npm run typecheck`/`npm run lint` clean.

---

## A sixth real bug: two-button intake fields silently dropped their second button

While verifying the button-click fix above in a real browser, the user found a related, adjacent
bug on the very next page: a button labelled "Back" that actually advanced *forward* — no "Next"
button visible at all on that page.

**Root cause, confirmed against the real recorded teleform definition
(`bin/console forms:record`)**: AsterMD's form builder supports authoring *two* buttons in one
field slot — `properties.buttonCount: 2`, with a `secondaryButtonLabel`/`secondaryButtonAction`
alongside the normal top-level `label`/`buttonAction`. Rameltion's real questionnaire has exactly
one of these: primary slot `{label: "Back", buttonAction: "next_page"}`, secondary slot
`{label: "Next", buttonAction: "next_page"}`. Neither this port's `FieldViewModel`/`field-button.ejs`
nor PHP's own `FieldViewModel.php`/`field-button.twig` ever read `buttonCount`/`secondaryButton*` at
all (confirmed via research agent against the PHP source directly, including its test suite, which
has zero coverage for this) — **both renderers silently drop the second button and show only the
primary slot**, which is how a page ended up showing a single "Back"-labelled button that actually
behaves as "next_page". This is a real gap in both codebases, not a MERN-specific regression.

Given the goal is a working storefront rather than reproducing PHP's own gap, built real two-button
support rather than leaving it broken: `FieldViewModel.for()` gained `secondary_label`/
`secondary_action` (populated only when `buttonCount === 2`), and `field-button.ejs` now renders
both buttons side by side in a two-column row (matching the shared nav's own Back/Continue layout)
when a secondary exists, falling back to the single-button case otherwise. **What the button says
and does is rendered exactly as authored, unexamined** — this partial does not try to "correct" a
button whose label and action disagree (e.g. "Back" that goes forward); that is real content sitting
in AsterMD's own form builder, worth flagging to whoever owns that questionnaire, but not something
template code should silently override. Verified live against the real teleform: the page that
previously showed one misleading "Back" button now shows both "Back" and "Next" side by side, exact
match to the raw authored data. Locked down with a new fixture entry in
`test/forms/intake-templates.spec.ts`.

Test suite: 332/332, `npm run typecheck`/`npm run lint` clean.

### A seventh real bug: required file-upload fields on Health History could be silently skipped, and a rejected submit threw its own answer away

Reported live: after filling in the Health History page (the last page of the real Rameltion
intake) and pressing Next, the visitor was dropped back to the very first page with no error and
no explanation. Confirmed as two compounding real bugs, not one, both found via a real Playwright
click-through against the live dev-sandbox teleform (`forms:record` first confirmed the red
required asterisks on this page are genuinely authored `required: true` in AsterMD's own data —
not a rendering bug — so the investigation moved to what happens *after* a required field is
actually missing):

1. **A required file-upload's real answer lives in a `type="hidden"` input, and hidden inputs are
   exempt from HTML5 constraint validation by spec** — `checkValidity()` reports one valid
   unconditionally, `required` attribute or not. Health History authors two conditionally-required
   file-upload questions (`file_upload_1789988974`/`file_upload_1789989147`, revealed and marked
   required only once the visitor answers "Yes" to their governing dropdown). `intake.js`'s
   `pageAnswered()`/`validatePage()` both walk `wrapper.querySelector('[required]')` and trust
   `checkValidity()` — so Next/Submit stayed enabled, and the client believed the page complete,
   even with both required files never attached. Verified live: with the governing dropdowns set
   to "Yes" and nothing uploaded, the Submit button was enabled before this fix and correctly
   disabled after. Fixed with a small `isControlAnswered()` helper that special-cases
   `type === 'hidden'` to check `value.trim() !== ''` directly instead of `checkValidity()`.
2. **A rejected submit threw the server's own response away.** `submit()`'s failure branch did
   `window.location.reload()` — a fresh GET, not a reuse of the POST response that already
   contained the real per-field errors and the exact page they belonged to. A GET carries no
   errors and the page always opened on page 0 (`goToPage(0)`, unconditional), so *any* real
   server-side rejection — on any page, not just Health History — looked identical to "thrown back
   to the start," even though every answer was still saved. Fixed two-sided: `IntakeController`'s
   `payload()` now computes `error_page` (the index of the first page holding an errored field,
   `null` when nothing errored) and `form.ejs` exposes it as `data-intake-error-page`; `intake.js`
   no longer reloads on a rejected submit — it writes the POST's own response body in place
   (`document.open()/write()/close()`) and opens on the page that attribute names instead of
   always page 0. Verified live: a raw POST to `/intake/submit` missing required Health History
   answers came back `200`, not redirected, with `data-intake-error-page="4"` and real, visible
   error text on the fields that actually failed (a conditionally-required textarea and a
   multi-select) — exactly what a visitor should see instead of a blind reset.

Separately, a genuine **content gap** worth flagging to whoever owns the AsterMD questionnaire (not
a code bug): `choice_multi_36` ("Do you take any of the following medications?") and
`choice_multi_37` (the substance-use screening question) are both required multi-selects with no
"None of the above" option — a patient who takes none of the three listed medications has no
honest way to answer. `dropdown_38` is fine (its three options are exhaustive).

---

## Next decision point

Phases 6 through 10 are done, including the Phase 9 asset pipeline + design pass, the Phase 6
multi-page intake stepping fix, both former Phase 10 scope questions (`payment:capture`/
`forms:record`; real `CatalogBuilder`/`MediaLocalizer` catalog-sync infrastructure, `theme:sync`/
`media:prune` wired for real), and real Vrio/CheckoutChamp payment adapters (all user-confirmed,
full-parity scope). The header cart dropdown and product-gallery thumbnail-swap UI polish items are
also done. Phase 11 (test suite consolidation) is in progress — see its own section above for what
landed this session and what's explicitly deferred, plus the real `theme:sync --apply` run and the
four bugs it surfaced, documented in the section directly above this one. Remaining:
`verify.ejs`'s mockup alignment (lowest priority — unreachable automatically in this build since
`verification.enabled` is `false`, though now provably reachable and correct via direct navigation —
see Phase 11's `/verify/` test), completing a full real Rameltion questionnaire submission end to
end, and mapping "liver function tests" to a real CheckoutChamp product/campaign id so a real charge
can be attempted for the first time.

### An eighth real bug: checkout never actually prefilled from intake answers, plus a real lost-update race in journey persistence

Reported live: name/email/etc. never auto-populated on the checkout page even after answering
them in the medical intake. Two distinct, real bugs, both confirmed against the live dev-sandbox
Rameltion teleform and fixed:

1. **`Prefill`/`RecordMapper`/`VerificationStep.dob()` all read a real teleform's `db_fields` map
   by the wrong key.** `TeleformMetadata`'s own doc comment assumed `db_fields` is keyed by each
   field's answer `name` (`text_1786002009`) — but the real AsterMD data keys it by the field's
   long-form `fieldId` (`text-1786002009432-697`) instead. `AnswerSet.value(name)`/
   `Definition.field(name)` are keyed by the short `name`, so every one of these three call sites'
   `answers.value(dbFieldsKey)` lookup silently matched nothing — checkout prefill, the EMR
   "opportunity" record write (name/email/DOB/height/weight/gender), and identity-verification's
   DOB read were all quietly broken for any real teleform, not just this one. Fixed with a new
   `Definition.resolveDbFields()` that re-keys a `db_fields` map by fieldId when a match exists,
   leaving an already-name-keyed entry untouched (so a hypothetical teleform matching the original
   assumption still works). Locked down in `test/forms/definition.spec.ts` and
   `test/checkout/prefill.spec.ts`.
2. **A real, live lost-update race in `JourneyStore`.** This storefront writes the *whole* journey
   state on every flush (no per-field update), so two requests for the same session that each
   read-modify-write independently can race — confirmed live: a slow intake save (a real EMR call
   partway through `IntakeSession.save()`) was still in flight when a checkout visit for the same
   session read the row, and checkout's own later flush — built from that older snapshot — silently
   overwrote the just-saved answers. Fixed with optimistic concurrency in `JourneyStore.flush()`/
   `SessionRepository.save()`: the write is guarded on the row's `updatedAt` as read at load time,
   and a conflict re-reads the row and retries once, replaying only the top-level fields *this*
   request actually changed onto the fresh copy (never a whole-snapshot overwrite, which would just
   move the same race one step later). A related, narrower race — `intake.js`'s own Next-click
   handler fired `save()` without awaiting it, so clicking through pages quickly could have two of
   its own saves in flight at once — is also fixed (`save()` is now awaited before advancing, with
   `aria-busy` guarding against a double-click reintroducing it). `JourneySaveBackMiddleware`'s
   flush was also moved earlier — awaited before `res.end()` completes rather than fired from
   `res.on('finish')` after the response was already sent — since a `fetch()`-driven save's
   auto-followed redirect is fast enough on localhost to start a second request before a
   fire-and-forget flush had finished. None of this makes the write instantaneous — a slow EMR call
   is still slow — but a later read (a real visitor's natural pace, not a scripted rapid-fire
   click-through) now reliably sees the correct, fully-merged state rather than a permanently lost
   write. Verified live over 8 repeated full add-to-cart → intake → checkout runs, 8/8 correct.

Test suite: 306 tests passing plus the two new spec files above (the remaining 30 failing tests are
the pre-existing Prisma AI-agent-consent-guard gate on `db push --accept-data-loss` in the DB-backed
e2e specs — an environment/tooling condition unrelated to this change; see `CLAUDE.local.md`).

---

### A ninth real bug: Pay Now was submitting to no form at all, for any product with a plan/dose selector

Reported live: clicking Pay Now on `/checkout/` produced zero visible effect. Confirmed with a
real click in a real browser: **zero network activity fired at all** — not a slow request, not a
declined one, nothing.

Root cause: `checkout.ejs`'s `plan-form` (the hidden dosage-selection form, referenced by the plan
radios via `form="plan-form"`) was written physically nested inside the main checkout `<form>`.
HTML has no nested forms — a browser's parser drops a second `<form>` open tag entirely once one
is already open, so `plan-form`'s own `</form>` closing tag had nothing of its own to close and
silently closed the *outer* checkout form instead. Everything after it in the markup — the card
fields, every consent checkbox, and the Pay Now button itself — ended up outside any form,
confirmed via `button.form === null` in a live page. This only affected a product with a plan/dose
selector (`checkout.plans` truthy) — a simple one-price product never hit the bug, which is why it
stayed invisible this long. The per-bump forms and the promo/promo-remove forms had the identical
nested-form mistake, just positioned later, so they only "worked" by accident (their own opening
tags landed after the outer form was already truncated).

Fixed by moving all four (`plan-form`, one `bump-form-<key>` per order bump, `promo-form`,
`promo-remove-form`) out from their inline positions to render after the main form's own closing
tag, exactly as their own trigger elements already assumed via `form="<id>"` — no button/input
needed to change how it's wired, only where the `<form>` tag itself sits. Also gave Pay Now the
`data-checkout-submit` hook `checkout.js` already expects on it (present in the JS, missing from
the template — without it, `checkout.js` couldn't tell Pay Now apart from a sub-action button
either, though the nested-form bug was the one actually blocking every click).

Verified live: Pay Now now correctly submits (`POST /checkout/`, real response in ~500ms) for a
product with a plan selector — previously zero requests fired at all for this exact case.
`npm run typecheck` clean; checkout test suite unaffected (52/59 passing — the other 7 are the
same pre-existing Prisma-consent-guard gate on DB-backed e2e specs, unrelated to this change).

---

### A tenth real bug: CatalogBuilder ignored which payment processor a mapping actually belonged to

Reported live: with the nested-form bug fixed and Pay Now actually submitting, a real charge
attempt still failed — `payment.lead_not_created` in the operator log showed CheckoutChamp's own
API refusing the request outright: `{"result":"ERROR","message":"Must provide campaignId"}`. Not a
card problem — the card is never evaluated at that point.

Root cause, found by fetching Rameltion's *raw* channel data directly (not the already-transformed
`products.generated.ts`): its variant carries **two** `product_mappings` entries — one `type:
"vrio"` (`offer_id: "338"`) and one `type: "checkout_champ"` (`offer_id: "457"`, tellingly named
`"Sbr_test"` — clearly placeholder/test data, not a real Rameltion offer). The channel's own
`payment_processor.provider_category` is `checkout_champ` — but `CatalogBuilder.providerFor()`
always took whichever mapping came first in array order, regardless of `type`, and Vrio's happened
to sit first. Every real checkout therefore sent CheckoutChamp `338` — a Vrio-side id CheckoutChamp
has never heard of — as `campaignId`, which its real API correctly refused.

**This exact "first wins" behaviour is not a MERN-only mistake — it's a faithful port of PHP's own
`CatalogBuilder::providerFor()`**, whose own doc comment names this precise scenario ("a vrio entry
and a checkout_champ entry for the same variant") and still picks first-in-array regardless. Fixed
here anyway, since the live failure is unambiguous: `providerFor()` now prefers the mapping whose
own `type` matches the channel's active `payment_processor.provider_category`, falling back to the
old first-match behaviour only when none of the candidates carry that type (so a channel with just
one processor's mapping — the common case — behaves identically to before). Locked down with two
new tests in `test/catalog/catalog-builder.spec.ts`. Re-synced live: `config/products.generated.ts`
now correctly carries CheckoutChamp's own offer id (`457`/`15227`) for Rameltion, not Vrio's.

Whether a charge actually succeeds now depends on whether `457`/`"Sbr_test"` is real CheckoutChamp
sandbox data or itself a placeholder that was never replaced with Rameltion's genuine offer — that
part is outside this codebase to fix; it needs whoever manages the real CheckoutChamp/AsterMD
account to confirm or correct it.

---

See `/home/codeclouds-saburali/.claude/plans/warm-floating-ripple.md` for the full phase-by-phase
plan and every correction found along the way, and `CLAUDE.local.md` for tooling/process notes
(package-version rules, the Prisma AI-safety guard).
