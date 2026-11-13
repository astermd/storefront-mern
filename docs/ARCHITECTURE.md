# Architecture

How the AsterMD storefront is put together, for a developer about to change it.

This is a Node 22 application on NestJS 11, with EJS templates and Prisma over SQLite. It sits
between two systems it does not own — the AsterMD API (the EMR) and a payment provider — and
sells prescription and over-the-counter treatments through a guarded funnel: browse, cart,
questionnaire, identity check, checkout, post-purchase upsells, receipt.

[`STACK.md`](STACK.md) covers the stack choices and the framework mechanics — bootstrap, the
container, how the middleware is registered, error boundaries, persistence tooling and
templates. This document covers how the storefront's own pieces behave.

Two ideas run through the whole codebase and explain most of its shape:

- **`src/` is application code; `views/`, `public/css`, `public/js` and `config/` are the
  deployment's.** Customisation happens in templates, in CSS, and in the override layer of the
  configuration files.
- **Every external system sits behind an interface with a Null implementation.** Nothing
  above a port knows the name of the system behind it, and `CoreModule` decides which
  implementation is bound. This is [the single most important idea in the codebase](#ports-null-implementations-and-the-container-seam).

Source files cite behaviour rules by id — `[24.2]`, `[20.1]`, `[13.32]`. Those ids resolve
in [`SPEC-REFERENCE.md`](SPEC-REFERENCE.md). A few appear below where a decision is otherwise
hard to place; the code itself is where they are dense.

---

## Repository layout

The directory tree is in [`STACK.md` § Layout](STACK.md#layout). In short: `src/` holds one
directory per area (`core/`, `middleware/`, `routes/`, `domain/`, `funnel/`, `journey/`,
`catalog/`, `forms/`, `checkout/`, `payment/`, `emr/`, `repository/`, `seo/`, `observability/`,
the sweeps and `console/`); `views/` holds the EJS templates; `config/` holds typed
configuration modules; `prisma/` holds the schema and migrations; `test/` holds the Jest specs.

`storage/` (logs, cache, sessions, the SQLite file) is gitignored and never served: only
`public/assets/` is mounted as static files, at `/assets/`.

---

## Request lifecycle

Bootstrap, the two error boundaries and the order in which Nest runs things are described in
[`STACK.md` § Request lifecycle](STACK.md#request-lifecycle). What matters for the rest of this
document:

- `AppModule` (plus the modules it imports) is the only place that knows how the pieces fit
  together. Everything else receives its collaborators by injection.
- Controllers are thin. They read the request, ask a service, and render a template; no
  controller makes an EMR or provider call directly.
- **Providers are built at boot, so construction must be cheap.** Nest instantiates a module's
  providers when the module initialises. Repositories therefore do no I/O in their constructors;
  a visitor can still browse and add to their cart — which is held in the HTTP session — while
  the database is unreachable.

### Error routing

Both boundaries delegate to `ErrorPresenter` (`src/support/error-presenter.ts`). Three tiers,
checked in order:

| Condition | Response |
| --- | --- |
| 404 | themed `pages/error-404.ejs`; `NotFoundController` (`@All('*splat')`, imported last) throws it for any unmatched path |
| any other `HttpException` with a 4xx status | themed `pages/error-http.ejs`, deliberately **not** logged — malformed or disallowed requests are not application faults |
| anything else | logged to `storage/logs/app.log` with a generated request id, and the same id shown on `pages/error-500.ejs` so a bug report can be matched to the log line |

Every error response carries `X-Robots-Tag: noindex, nofollow`, set by `ErrorPresenter` itself
from `RobotsPolicy.REFUSED` — the same constant the error templates render their meta tag
from, so the two halves cannot disagree.

The unhandled-exception log line records the request **path only, never the full URI** —
query strings carry tracking payloads and resume identifiers, and key-based redaction
cannot see inside a URI string.

---

## The middleware pipeline

Nine pinned middleware slots run on every request, after `cookie-parser` and before Nest's
routing. They are registered in one `consumer.apply(...)` call in `AppModule#configure()`, in
the order below, and [`MIDDLEWARE.md`](MIDDLEWARE.md) covers each slot in depth.
`test/middleware-ordering.e2e-spec.ts` enforces the order against the `X-MW-Trace` header each
slot appends under `NODE_ENV=test`. A silent reordering would change session, CSRF and
indexing semantics without any single middleware's own tests noticing.

```
outermost
 1  CanonicalUrlMiddleware      one-hop 301 to the canonical URL form
 2  SeoMiddleware               publishes page metadata; writes X-Robots-Tag
 3  SessionMiddleware           express-session
 4  RetiredSessionMiddleware    clears the analytics cookie of a finished journey
 5  AttributionMiddleware       resolves the analytics session; first-touch capture
 6  CsrfMiddleware              mints the token; rejects unauthenticated mutations
 7  JourneySaveBackMiddleware   writes durable journey state back, once
 8  StepGuardMiddleware         enforces funnel step preconditions
 9  TemplateGlobalsMiddleware   publishes res.locals before the handler runs
innermost → Nest routing → controller
```

Nest routes the request only after the middleware has run, which is why the step guard matches
steps by path rather than by route argument: there is no matched route to read yet.

### Why the positions are what they are

**1 → 2, canonicalisation before SEO.** The canonical URL `SeoMiddleware` publishes has to
be built from the canonicalised path, so canonicalisation must already have run.

**2 outside everything else.** `[24.2]` requires the indexing directive to be enforced
twice — as a response header *and* as a meta tag — from one value. This middleware is the
header half and the source of the value the meta half renders. It has to reach every
response the application produces, including the ones the session, journey and step-guard
slots redirect away before a controller sees them.

**3 outside 6.** CSRF keeps its token in the session.

**4 outside 5.** The analytics cookie is issued by `AttributionMiddleware`, and a browser
applies `Set-Cookie` headers in the order it receives them — a clear written after the issue
would be the one that wins, and a clear written before it would be overwritten by the very
re-issue it is cancelling. `RetiredSessionMiddleware` patches `res.writeHead`, so its clear is
appended at the last moment, after attribution's header.

**5 outside 6 and 7.** Attribution is captured before anything reads it, and the state it
mutates is still persisted on the way out.

**6 outside 7.** A request rejected for a bad CSRF token never writes journey state —
correct, because such a request mutated nothing.

**7 outside 8 and 9.** The save-back happens only after the handler is done with the state
it was given. `JourneySaveBackMiddleware` wraps `res.end`, so the flush runs before the response
completes — after a normal render, a redirect from the step guard, or an error page alike — and
also on `close` for an aborted connection.

**9 innermost, and it runs before the handler.** The globals published on a mutating request
describe the cart as it looked on the way *in*. That is safe only because `CartController`
answers every mutation with a 303 redirect and renders nothing itself — the response that
would show a stale drawer is never produced, and the GET that follows rebuilds the globals
from the cart the handler actually saved.

### Degradation

Slots 5, 7, 8 and 9 degrade rather than fail. Analytics session creation is a
must-degrade-silently dependency: a visitor must get their page even from a storefront whose
database is unreachable or unmigrated. `AttributionMiddleware` logs `session.resolve_failed`
and continues; the save-back logs `journey.save_failed`; the step guard logs
`funnel.guard_unavailable` and lets the request through rather than judging a fabricated empty
cart; template globals log `cart.globals_unavailable` and render without the drawer.

`RetiredSessionMiddleware` fails open in every direction: an unreachable journey store or an
unresolvable path leaves the cookie alone. The harm in that direction is a stale analytics
session; the harm in the other is a buyer losing their receipt one request after paying for it.

---

## The source map

`src/` grouped by what each area is for rather than alphabetically.

### Wiring and delivery

| Directory | Owns |
| --- | --- |
| `core/` | `CoreModule` — every port-to-implementation binding — and `tokens.ts`. |
| `routes/` | One Nest module and thin controller per area (home, catalog, cart, intake, verify, checkout, upsell, receipt, legal, seo, health, fallback). |
| `middleware/` | The nine pinned slots, plus `trace.ts`. |
| `support/` | Cross-cutting utilities: `ConfigService`, `Url` (path canonicalisation), `AssetManifest`, `OperatorLog`, `CardScrubber`, `RequestContext`, `RateLimiter` / `DatabaseRateLimiter`, `ErrorPresenter`, `FailureDigest`. |
| `console/` | `nest-commander` commands — thin wrappers over the services below. |

### The domain

| Directory | Owns |
| --- | --- |
| `domain/` | Pure rules over a cart and a catalog: `Cart`, `CartLine`, `CartRules`, `FunnelRouter`, and the `ProductCatalog` / `StepRouter` read ports. No I/O, no framework types. |
| `funnel/` | The funnel as data: `FlowDefinition`, `StepPreconditions`, `FunnelRules`, `FurthestStep`. |
| `journey/` | Durable server-side journey state: `JourneyState`, `JourneyStore`, `CartStore`, `SessionResolver`, `SessionOptions`, `Attribution`. |
| `catalog/` | The catalog pipeline: `CatalogBuilder` (from an EMR payload), `CatalogMerger` (overrides over generated), `CatalogProvider` (the runtime entry point), `CatalogValidator`, `MediaLocalizer`, `GeneratedConfigWriter`. |

### The funnel's stages

| Directory | Owns |
| --- | --- |
| `forms/` | The intake questionnaire engine: teleform metadata and definition fetch, `DefinitionCache`, field view models, rule evaluation, answer validation, disqualification, lead writing, file uploads. |
| `verification/` | The identity-check step: `VerificationStep`, `IdentityVerificationSequence`, `VerificationPlacement`, `IdentityVerdict`. |
| `checkout/` | The checkout decision surface: `CheckoutService`, buyer validation, consents, order bumps, promotions, totals, idempotency, order recording, `PostChargeGuard`. |
| `payment/` | The provider boundary: the `PaymentAdapter` contract, `AdapterCapabilities`, `AdapterRegistry`, `PaymentCredential`, and the `vrio/`, `checkout-champ/` and `stripe/` adapters. |
| `upsell/` | Post-purchase offers: `Upsells` (configuration), `UpsellQueue` (where a journey has got to), `UpsellService` (the charge). |
| `completion/` | What reaching the receipt does: the completion actions, once, then teardown. |

### The outside world

| Directory | Owns |
| --- | --- |
| `emr/` | Orchestration over `@astermd-hq/sdk`: `EmrClientFactory` (credentials from `process.env`, file-backed token cache), the session / cart / verification / coupon / address gateways, `CartMirror`. |
| `repository/` | The only code that touches the database: `SessionRepository`, `OrderRepository`, `EventRepository`, `CheckoutAttemptRepository`, `RateLimitRepository`. |
| `database/` | `ConnectionFactory` — builds the `PrismaClient`. |

### Presentation

| Directory | Owns |
| --- | --- |
| `seo/` | `RobotsPolicy`, `MetaResolver`, `PageMeta`, and the `structured-data/` emitters. |

### Operating the thing

| Directory | Owns |
| --- | --- |
| `observability/` | `Boundary`, `BoundaryTimer`, `Instrumentation`, the seven `Instrumented*` decorators, `Measured`, `OperationalCounts`, `CorrelationContext`. |
| `reconciliation/` | The forward sweep (orders the EMR was never told about) and the reverse sweep (provider orders with no local row). |
| `abandonment/` | Which journeys have stopped moving, and what state each stopped in. |
| `retention/` | `RetentionPolicy` and the sweeps that expire aged rows and log files. |

---

## Ports, Null implementations, and the container seam

**This is the pattern the rest of the codebase is built on.** Every external system sits
behind an interface bound to an injection token (`src/core/tokens.ts`). Each interface has a
real implementation that talks to the system and a **Null implementation that talks to
nothing**, and `CoreModule` decides which one is bound. The full port table is in
[`STACK.md`](STACK.md#ports-and-their-null-counterparts).

Three read ports have no remote system behind them: `ProductCatalog` (satisfied by
`CatalogProvider`), `StepRouter` (satisfied by `FunnelRouter`, declared as a port so the guard's
branching can be tested against a router that names any step), and the structured-data
`Emitter`.

### What binds the Null ones

Configuration switches, all read inside `CoreModule`'s factories:

- **`app.session.analytics`** governs the EMR gateway family — session, cart, teleform,
  intake, intake uploads, lead. `config/app.ts` derives it as `NODE_ENV !== 'test'`, so **under
  the test suite the whole EMR family is Null-bound and no test run can reach the network or
  write to a real EMR.** Tests that exercise session or intake flows override the provider
  instead.
- **`verification.enabled`** governs `IdentityGateway`. Off as shipped, and therefore always
  off under tests. It deliberately does *not* follow the checkout verification switches: the
  two govern different resources that happen to share an EMR endpoint family, and tying them
  together would mean an operator could not have the checkout address check without also
  running identity checks that, as recorded against the live integration, currently refuse
  everybody.
- **`app.features.emrVerifyEmail` / `emrVerifyAddress`** govern `VerificationGateway` (email
  deliverability and address checks at checkout), each check under its own switch. Both off by
  default and forced off under test.
- **`NODE_ENV=test`** binds `CouponGateway` to its Null implementation; `addressAutofill` gates
  `AddressAutofill`.

`PaymentAdapter` works differently: it is not switched by environment but resolved from the
synced provider category (see [Payment](#payment)), falling back to `NullPaymentAdapter` when
nothing is configured. Under test each real adapter is built over a refusing transport, so a
test that forgot a stub fails instead of reaching a provider.

### Null is a behaviour, not a stub

A Null implementation returns the answer that means "this degraded exactly as the funnel
already expects", not a blank one — and the difference is a design decision each of them
states:

- `NullSessionGateway` reports "no session could be created" (`null`) and "this session is not
  known", both states the funnel already has to handle, so switching analytics off degrades
  the storefront rather than changing its behaviour.
- `NullCartGateway` and `NullIntakeGateway` report **success** unconditionally. A deployment
  with analytics off must behave exactly like one whose mirror always succeeded; reporting
  failure would be read as "the save failed" and could surface a retry or a warning to a
  visitor whose form is working exactly as configured.
- `NullIdentityGateway` answers **inconclusive** to everything, and never `passed`. A
  deployment may run the identity step blocking, and a disabled gateway reporting a pass
  would let anyone through the moment an operator switched identity checks off — turning "we
  are not checking" into "everyone checks out".
- `NullPaymentAdapter` declares no promotion support (so the promo control is hidden) and
  turns every placement into a decline with a buyer-safe "temporarily unavailable" message. An
  unconfigured storefront renders and browses normally and fails only at the point money would
  move, rather than erroring on the checkout page.

### The container is the seam

`Test.createTestingModule({ imports: [AppModule] }).overrideProvider(TOKEN)` is the documented
test seam and the only one: a test substitutes a fake gateway, a fake adapter or a prepared
database without a second bootstrap path. `test/support/test-app.ts` then applies the same view
engine, helpers, validation and error boundaries as `src/main.ts`. See
[`STACK.md` § The test seam](STACK.md#the-test-seam).

`ConfigService` reads `process.env` once, in its constructor, so a test that needs a different
configuration overrides `ConfigService` (or the specific provider) rather than mutating the
environment after boot. Overriding `ConfigService` re-resolves every factory that injects it —
payment, checkout and retention included — so the override is broad, not surgical.

Request-scoped state uses `Scope.REQUEST`. Two rely on that explicitly: `JourneyStoreFactory`,
because the resolver and the save-back middleware must see the same `JourneyStore` or the
save-back would flush an empty state; and `CartStoreFactory`, because a controller and the
templates rendering its result must see the same cart or they will disagree about what is in it.

---

## Observability decorators

`src/observability/` wraps the same ports to record outcome and latency. `Instrumentation` is
the one class that does the wrapping — seven methods, one per port — rather than `new`
expressions scattered through `CoreModule` or edits at call sites.

```
CoreModule  →  InstrumentedSessionGateway  →  EmrSessionGateway  →  the EMR
               (implements SessionGateway)
```

A decorator sits **between the container and the port**. Every one implements the interface
it wraps and returns exactly what the port returned, so substituting one is invisible to
every caller — which is what makes it safe to leave switched on in production and what stops
the instrumentation from becoming the failure.

The reason the timing lives here rather than at call sites is that the storefront degrades
silently by design: a broken dependency does not surface as an error, it surfaces as a funnel
that quietly stops converting. An EMR that has stopped minting sessions looks identical to a
quiet afternoon unless the outcome is counted. `Boundary` names every external call the
storefront makes, so the set is enumerable rather than discoverable by grepping for a logging
call, and one dependency cannot end up logged under two spellings. Latency comes from
`process.hrtime.bigint()`, a monotonic clock.

**Anything reflecting into a port must expect to peel one.** `Instrumentation` is applied to
the session, cart, teleform, intake and lead gateways, to the payment adapter, and to the
checkout event reporter. A test asserting on what the innermost object holds walks the
`inner` property until it finds what it is looking for, rather than naming a decorator class.

Not every decorator is observability. `RecordingIntakeGateway` wraps whichever
`IntakeGateway` the analytics flag produced and writes the local audit line either way,
because the EMR half is analytics and the storefront's own record is not.

`Measured` carries the four answers a monitored figure can have — `measured`, `floor`,
`not_checked`, `unavailable` — because zero and "could not be counted" are different answers,
and a status surface that renders them the same reports an all-clear on exactly the runs that
could see nothing.

---

## Configuration

Each file under `config/` is a TypeScript module exporting a typed interface and a loader.
`ConfigService` (`src/support/config.ts`) calls each loader once with `process.env` and exposes
the results as typed properties — `config.app`, `config.funnel`, `config.payment`, and so on — so
a missing key or a wrongly typed value is a compile error rather than a runtime surprise.
`.env` is loaded by `dotenv` at the top of `src/main.ts`, before anything reads the environment.

| File | Owned by |
| --- | --- |
| `app.ts` | client — site identity, database, EMR host, session, SEO, feature flags, debug |
| `funnel.ts` | client — the step table: which URL is which named step, and what it requires |
| `verification.ts` | client — identity-check placement, blocking, and which checks run |
| `consent.ts`, `cross-sells.ts`, `upsells.ts`, `payment.ts`, `intake.ts`, `retention.ts`, `abandonment.ts` | client |
| `products.generated.ts` | **machine** — overwritten wholesale by `theme:sync`; gitignored, since it is one channel's catalog. `products.generated.example.ts` is the committed shape |
| `products.overrides.ts` | **client** — never touched by a sync |
| `channel.generated.ts` | **machine**, merge-not-replace; gitignored, since it carries live provider credentials |

The generated files are source modules resolved at build time: a sync takes effect once the app
is rebuilt and restarted.

### Generated versus override

`npm run console -- theme:sync --apply` fetches the configured EMR channel, builds a catalog
from it, and rewrites `config/products.generated.ts` in full. `config/products.overrides.ts` is
the client's, and no sync writes to it. `CatalogProvider` layers the second over the first
through `CatalogMerger` once, at construction, and serves the merged result for the life of the
process.

The merge rules, all in `CatalogMerger`:

- **Products are matched by `emr_product_id`, never by slug or name** (`[2.2]`). Slugs are
  allowed to change — an override may set one, which re-keys the product in the merged map
  *and* updates its `slug` field — so a slug cannot be the join key.
- **Every field other than `variants` replaces the generated field wholesale.** No deep
  merge: an overridden `categories` list replaces the whole list, which keeps the result
  predictable.
- **`variants` merge per variant id.** Fields land on the matching variant; variants not
  mentioned are untouched, and none are dropped or reordered.
- **An override id matching no generated product** is added as a net-new product if it is a
  full definition (at minimum `slug`, `name`, `kind`, `variants`), and silently skipped
  otherwise. Skipped ids are readable via `lastIgnoredOverrideIds()`.
- **Slug collisions are not silently swallowed.** A re-key or a net-new product landing on a
  slug another product occupies throws, naming the slug, because silently overwriting one
  product with another is catalog data loss.

The override layer is also where fields the EMR payload has no room for live — geo blocks,
prequalification settings — and where the SEO description override lives, which matters
because products synced from the EMR can carry an empty description.

---

## Persistence

The connection (`ConnectionFactory`, a `PrismaClient` over the `PrismaBetterSqlite3` driver
adapter), the fixed `sqlite` provider and Prisma's migration workflow are described in
[`STACK.md` § Persistence](STACK.md#persistence). Migrations live in `prisma/migrations/` and are
applied by `npm run console -- db:migrate` (`prisma migrate deploy`); a correction to an
already-applied migration belongs in a new migration, never an edit to the old one.

### The schema

| Table | Holds |
| --- | --- |
| `sessions` | one row per analytics session: `session_uuid` (PK), `opportunity_id`, `journey_state` JSON, `attribution` JSON, `created_at`, `updated_at` |
| `orders` | `session_uuid` (nullable FK), `provider_reference`, `anchor_slug`, `amount_cents`, `discount_cents`, `currency`, `status`, `settlement`, `treatment_reference`, `verification_status` / `verification_at`, buyer name/email/territory, `payment_method`, `card_last_four`, `promotion_code`, `idempotency_key`, `provider_category`, `is_upsell`, `user_agent`, `placed_at` |
| `order_lines` | `order_id` FK, `slug`, `name`, `kind`, `provider_offer`, `provider_item`, `unit_price_cents`, `quantity`, `sent_to_provider` |
| `order_consents` | `order_id` FK, `consent_key`, `granted`, `copy_version`, `copy_shown`, `recorded_at` — the copy as shown, not a reference to it |
| `events` | append-only local audit trail: `session_uuid`, `name`, `payload` JSON, `created_at` |
| `checkout_attempts` | `idempotency_key` (**UNIQUE**), `session_key`, `state`, `outcome`, `created_at`, `completed_at` |
| `rate_limits` | `bucket`, `identity`, `hits`, `window_start` (integer), unique on `(bucket, identity)` |

**Money is integer cents everywhere.** `amount_cents`, `discount_cents`,
`unit_price_cents`, every price in the catalog, every total in the domain. There is exactly
one conversion to dollars, `Totals.dollars()`, used at the EMR checkout-event boundary — the EMR
documents decimal dollars, so a skipped conversion would silently multiply every reported order
by a hundred and nothing downstream would complain.

**`orders.session_uuid` is nullable**, and that is deliberate: an analytics-off deployment,
or one whose EMR session could not be minted, must still be able to take an order, and
inventing an identifier to satisfy a NOT NULL constraint is the synthetic identifier the
storefront is forbidden to produce.

**`checkout_attempts.idempotency_key` being UNIQUE is the entire mechanism** that stops a
double charge. The claim is a conditional insert, so two concurrent submits race on the index
and exactly one wins. The payment provider offers no idempotency of its own — an identical
payload posted twice creates two orders and charges both — so that index is what stands
between a double-click and a double charge. The state vocabulary has three values (`claimed`,
`sent`, `complete`) rather than two because `claimed` may be taken over by a retry and `sent`
may not.

**Nothing stores a card.** `orders.card_last_four` is the only card-derived column in the
schema, and four digits are what a receipt and a support call need.

**Timestamp columns are strings holding `new Date().toISOString()`** — fixed-width UTC. That is
what makes lexicographic order chronological order, and therefore what makes a plain string
comparison a valid range query for every retention, abandonment and reconciliation sweep. It
is only true because *every* writer uses that format; a writer that did not would silently
break the range scans rather than fail. The one column that is not a string is
`rate_limits.window_start`, an integer of unix seconds, which the sweeps compare differently on
purpose.

Indexes exist where a scheduled sweep reads: `orders.treatment_reference` (the forward
reconciliation predicate), `orders.placed_at` and `orders.provider_reference` (the reverse
sweep), `sessions.updated_at` (abandonment and session expiry), `checkout_attempts.created_at`
and `rate_limits.window_start` (pruning), `events.created_at` (audit-trail expiry — the
largest table on a busy deployment by a wide margin). `sessions.created_at` deliberately gets
none: a journey's age for retention purposes is when it last moved, not when it began.

---

## Journey state

The **journey** is the durable, server-side record of one visitor's pass through the funnel,
keyed by the analytics session uuid and stored in `sessions.journey_state`. Browser storage
is a cache of that row and never the system of record, because cross-device resume and the
abandonment sweep both have to read it with no browser present.

```
SessionResolver     decides which session this request belongs to
      │             cookie  >  mint
      ▼
JourneyStore        loads the row once, hands the same instance to everyone,
      │             writes it back once (JourneySaveBackMiddleware)
      ▼
JourneyState        cart, form answers and statuses, furthest step, buyer,
                    consents, promotion, placed orders, reusable payment handle,
                    upsell queue / cursor / outcomes, receipt snapshot,
                    verification verdict, completion timestamp, retirement flag
```

**Resolution order.** A valid `amd_session` cookie is trusted and its journey loaded. With no
cookie, and on a request allowed to mint (a plain GET on a real, non-excluded route), a session
is minted at the EMR as soon as a visitor arrives rather than at the first cart action, which is
why the create payload carries the attribution captured moments earlier. Anything else resolves
to **null** and the journey continues untracked. Adopting a session named by a signed resume
link and re-minting a session the EMR no longer recognises are not built yet — see
`SessionResolver`'s doc comment.

### The fingerprint-gated save-back

`JourneyStore.flush()` compares a fingerprint taken at load time against the state as it
stands at the end of the request, and **writes nothing when they match**. The comparison
replaces a dirty flag deliberately: the failure mode of a missed dirty flag is silent data
loss on a step the visitor believes they completed.

That gate is what makes **`sessions.updated_at` a true "last moved" rather than "last seen"**.
A visitor who reloads the checkout page ten times does not reset their own abandonment clock;
one who adds a line to their cart does. The abandonment sweep and the retention sweep both
depend on that being true.

The write is guarded by optimistic concurrency: `flush()` writes against the row's `updated_at`
as it stood at load, and on a conflict re-reads the row and replays only the fields this request
changed, so a slow request cannot overwrite a faster one's newer answers with a stale snapshot.

Handlers mutate the state object they were given and never touch a repository. That is what
keeps a handler from being clobbered by a save-back it did not know was coming, and it is why
`JourneySaveBackMiddleware` is the only place journey state is persisted. A failed write is
logged and swallowed — a lost analytics write must not become the visitor's problem — but a
write that matched *no row* is raised as `JourneyWriteFailed` rather than returned quietly,
so it leaves a line an operator can find.

### The cart lives in two places

`CartStore` keeps the working copy in the **HTTP session** (`express-session`) and mirrors every
save into durable journey state. Two stores, because each covers the other's hole: durable state
is keyed by a session uuid, and there are ordinary deployments with no uuid at all — so a cart
kept only there could never be written, and a storefront that cannot take an order because
tracking is down is exactly what the degradation rule forbids. The HTTP session, conversely,
is browser-scoped and cannot serve cross-device resume.

Precedence is decided by a session stamp stored beside the lines rather than by a flag
someone has to remember to set. When the stamp does not match the session this request
resolved to, the browser is carrying a cart from a different session, and the durable copy for
the *current* session wins — unless there is nothing there, in which case the anonymous cart is
adopted into the new session rather than thrown away.

### One note before you extend `JourneyState`

`formAnswers` holds clinical answers, which are PHI. They are there because a questionnaire
has to be resumable across devices and sessions, which browser-scoped storage cannot do — but
it means the `journey_state` JSON column stores health information alongside funnel
bookkeeping. An answer must never be logged, never appear in an exception message, and never
be echoed into an analytics payload.

---

## The funnel

The funnel is **data**, not annotations on routes. `config/funnel.ts` names each step, its
URL, and what must already be true before a visitor may enter it:

```
home → prequalification → intake → intake.medical → verify → checkout → upsell → receipt
/      /intake/eligibility/ /intake/ /intake/medical/ /verify/ /checkout/ /upsell/ /thank-you/

not_eligible (/not-eligible/) — a terminal off-ramp, reachable from anywhere
```

`checkout` deliberately does not require `intake_satisfied`: this deployment collects the intake
questionnaire from the patient portal *after* the order is placed. It does require
`not_disqualified`, so a hard stop still outlives that choice. See the doc comment in
`config/funnel.ts`.

Four pieces implement it:

**`FlowDefinition`** reads that table once. Every declared path is canonicalised at
construction, and every path handed to `stepForPath()` goes through the same
`Url.canonicalizePath()` the redirect middleware uses — so a case-different or slash-less
spelling of a guarded URL cannot slip past the guard by comparing unequal to what was
declared. `pathFor()` throws on an unknown step name, because a redirect target that
silently becomes `''` is a redirect to nowhere.

**`FunnelRouter`** (implementing the `StepRouter` port) answers "where should this visitor be
right now". It is deliberately *not* a forward-only table: the guard asks it about a visitor
who has just failed a precondition, so an answer ignoring what they had already finished
would send someone who completed a questionnaire back to the start of it. Every branch reads
journey state as well as the cart.

**`StepGuardMiddleware`** enforces preconditions in one place, so no funnel template carries a
guard of its own. Its redirect target is the routing decision, not "the first step with unmet
preconditions" — with an empty cart *every* funnel step is unsatisfied, and walking the list
would send the visitor to a step that would bounce them again. When the routing decision names
the step the visitor is already on, the guard fails closed: it redirects to
`FlowDefinition.ENTRY_STEP` and logs `funnel.guard_self_redirect`, because serving the unguarded
page is never the safe branch.

**`StepPreconditions`** implements the named predicates the config file refers to —
`cart_not_empty`, `prequalification_satisfied`, `intake_satisfied`, `not_disqualified`,
`verification_satisfied`, `plan_chosen_for_every_rx_line`, `order_placed`. Named rather than
inline functions so the flow stays readable data and an unknown name fails loudly: a mistyped
requirement that quietly evaluated true would leave a step unguarded.

The router and the guard share one implementation of the rules they both need —
`FunnelRules` — because the guard decides whether a visitor may stay and the router decides
where they go instead, and a funnel where those two disagree either strands the visitor or
leaves a step unguarded.

### Three subtleties worth carrying

**The form preconditions are "satisfied *or not required*", not "completed".** A cart with
nothing to ask passes them, and a channel that folds its eligibility questions into the intake
form authors no separate pre-qualification form at all — so demanding completion of a form that
does not exist would make the next step permanently unreachable rather than guarded.

**A journey that could not be loaded is a third answer, not a synonym for "not satisfied".**
When session resolution fails, there is no state and every durable fact is *unknowable* rather
than known-false. Each precondition picks its own direction of failure for that case: the
questionnaire gates stay **shut**, because an outage does not make an uncollected medical form
safe; `order_placed` **opens**, because by the time the receipt or the upsell is asked for the
money is taken and locking a buyer out of their own receipt is the worse failure.

**Upsell and receipt cannot be guarded on the cart at all.** The cart is cleared the moment an
order is placed (`[13.32]`), so by the time a buyer reaches either page it is empty and
indistinguishable from a visitor who never had one. The placed order recorded on the journey
is the only fact left — durable, server-side, and unforgeable from the browser.

### The one monotonic advance rule

`src/funnel/furthest-step.ts` is the only writer of `JourneyState.furthestStep`, and every
writer calls `FurthestStep.advance()` rather than assigning — so "only ever forwards" is a
property of the class instead of a habit call sites have to keep. A visitor who reached checkout
and went back to edit their questionnaire has not un-reached checkout.

Its `ORDER` constant declares the progression **there rather than reading it from the flow**.
`config/funnel.ts` is the step *vocabulary* — every name in `ORDER` must be one of its keys —
but its key order is not a progression: `not_eligible` sits between `checkout` and `upsell`
there while being a terminal off-ramp reachable from anywhere. Ranking by position would make a
monotonicity rule out of an incidental detail of a config file. `not_eligible` is absent from
`ORDER` because it is not a step anybody completes.

Two edge answers are decided rather than obvious. An unrecognised *candidate* is refused
outright, leaving the last true value standing, because writing a name the funnel does not
declare would put a step into the abandonment signal that nothing can turn back into a URL.
An unrecognised *current* value is overwritten, because it can only be a stale spelling, and
blocking on it would freeze the field permanently.

---

## Payment

`src/payment/payment-adapter.ts` is the whole provider boundary. Every provider-specific
fact lives behind it: payload field names, status vocabularies, attribution slot maps,
credential handling. **Nothing above this interface may name a provider**, and adding one
must be an adapter plus a registry entry and nothing else.

### The contract declares capabilities

`capabilities(): AdapterCapabilities` is what the storefront asks before it renders anything,
so the UI adapts rather than discovering a missing capability at runtime. The declaration
carries `providerCategory`, `supportsPromotions` (false hides the promo control entirely),
`discountScope`, `credentialStrategy`, `collectionSurface`, `requiredConfigKeys`,
`routingHintKeys`, `pciPosture` (what it reports to an operator), `supportsRefund` /
`supportsRecurring` / `supportsOrderSearch` / `supportsAuthorizeCapture` /
`supportsClientAction`, and the client-side configuration a collection surface needs.

`collectionSurface` travels with `credentialStrategy` because they are one decision:
tokenization only reduces PCI scope when the card is collected in a surface the storefront does
not control, so an adapter declaring tokenization must also declare where its fields live.

`place()` **must never throw for a provider-side outcome**, and `searchOrders()` and `capture()`
must never throw at all. A refused card, a missing reference, a malformed response and a network
failure are all a `PlacementOutcome.declined()` with a buyer-safe reason — the visitor has to be
able to see a reason and retry, not hit an error page. For search, a failure is explicitly *not*
an empty result, because a sweep that read an outage as "no orders were lost" is the silent
failure reconciliation exists to end.

### The registry

`AdapterRegistry` maps provider category to adapter. `CoreModule` registers the `vrio`,
`checkout_champ` and `stripe` adapters as **factories rather than instances**, so building one —
which reads credentials and constructs an HTTP client — happens only for the category actually
configured. A misconfigured provider must not break the home page.

The category is chosen from **synced channel data**, never named by a code path:

```ts
registry.for(config.payment.adapter ?? channelGenerated.payment_processor.provider_category)
```

`channel.generated.ts` is written by `theme:sync`; `config.payment.adapter` is an operator
override for a deployment that has to pin one. An unconfigured or unknown category resolves to
`NullPaymentAdapter` and is logged (`payment.adapter_unavailable`) rather than throwing, and so
does an adapter whose factory fails to build — a channel whose payment processor has not been
synced yet should still serve its catalog.

### The adapters

`src/payment/vrio/`, `src/payment/checkout-champ/` and `src/payment/stripe/` each hold one
provider's adapter, payload mapping, outcome mapping, refusing transport (for tests) and wire
log. Nothing above them knows the provider's name, field names or status vocabulary.

The Vrio adapter's credential strategy is **reference-order**: a later charge on the same
journey names a `customer_id` + `customer_card_id` pair returned by an earlier placement, with
no card number, security code or expiry in the request. The pair is minted from the provider's
own response and never accepted from a request.

Each wire log decorates the provider client's own transport rather than replacing it, so
behaviour is identical whether the debug switch is on or off.

### Where the card goes, and where it does not

**Card data never reaches the EMR.** The storefront charges at the payment provider and
*then* tells the EMR that an order exists. The EMR is told about treatments and funnel events;
the provider is told about money.

The card also never reaches storage. It arrives as a `PaymentCredential` and is handed to the
adapter, and that is the end of it — no field of `JourneyState` carries it past the request.
What survives to pay for a later charge on the same journey is `reusableCredentialData` — the
opaque handle the provider issued, which is not a card and is therefore allowed to be durable.
It is written only through `JourneyState.storeReusableCredential()`, which calls
`PaymentCredential.toStorable()`, and `toStorable()` throws for a raw card credential. A
deployment whose adapter declares no reusable handle has nothing to charge an upsell against,
and that is the correct trade — holding a card across requests to sell an add-on would put the
whole deployment in full PCI scope.

`PaymentCredential` redacts itself in the two places Node serialises an object: `toJSON()` and
`[util.inspect.custom]`.

Two layered defences protect the logs. `OperatorLog.redact()` is key-based and blanks values
under names the codebase's own structures use. `CardScrubber` is value-based and looks
*inside* strings — for the security code and expiry by the key they sit next to
(`cvv=737`, `ccexp=1230`), and for any 13–19 digit run that passes a Luhn check. The second
exists because a provider echoing `gateway_request_text` returns one opaque string with a PAN
somewhere in the middle of it, under a key no redaction list would think to name. The checkout,
payment, upsell and completion code that records provider text applies the scrubber before
writing it.

### The order of operations in checkout is the specification's

`CheckoutService.submit()` runs, in order: refuse a flood; re-price a stored discount code
against the cart actually in hand; validate the buyer and record consents; re-run the geo gate
against the freshly submitted territory; store the buyer *before* the provider call so a
decline or a crash still re-fills the form; claim the idempotency key; assemble one envelope
for the whole cart; mark the attempt sent; place it; and only then, on success, run the
completion sequence that clears the cart.

Deliberate exceptions to degrade-silently live there — among them a blocking consent not
granted, a geo block, a checkout attempt that could not be recorded before the charge, and a
discount whose figure moved when re-priced. Each stops the order, because a payment nobody can
reconcile to a local record, or a total the buyer never saw, is worse for the buyer than being
asked to try again.

**Past the charge, nothing may reverse.** Once `place()` has returned, the money may have
moved, and from that point no failure of ours may reach the buyer as a failure. Every write
after the call runs inside `PostChargeGuard.run()`, which logs what could not be written as a
reconciliation item and lets the order stand. The same guard covers the upsell charge and the
completion actions, because two copies of that rule would drift.

---

## The theme

```
views/pages/        home, treatments, product, intake/*, verify, checkout, upsell,
                    thank-you, not-eligible, legal/*, error-404 / error-500 / error-http
views/partials/     head, foot, header/footer variants, cart drawer pieces, stepper,
                    intake/ field partials, structured-data
public/css/app.css  Tailwind v4 source; design tokens at the top
public/js/          cart.js, checkout.js, intake.js, intake-engine.js, verify.js, upsell.js,
                    datepicker.js, script.js, payment-stripe.js, address-autocomplete.js, vendor/
```

### Pages and partials

EJS has no template inheritance, so every page includes `partials/head.ejs` at its top and
`partials/foot.ejs` at its bottom, passing the locals those partials need. See
[`STACK.md` § Templates](STACK.md#templates).

`public/css/app.css` opens with a design-token block that is the single reskinning point:
every colour, radius, shadow, spacing alias, font stack and transition used across the
storefront resolves back to a variable there. Reskinning means editing hex values, not
touching template markup.

### The asset build

`npm run build:assets` runs `build/build-assets.mjs`, which compiles `public/css/app.css`
through the Tailwind v4 CLI, copies each file under `public/js/` (including `vendor/`), gives
every output an 8-character content hash, and writes `public/assets/build/manifest.json`
mapping logical name to hashed name:

```json
{ "app.css": "app.c579848a.css", "script.js": "script.27ba6a44.js", … }
```

The output is gitignored and built at deploy time (`npm start`'s `prestart` hook runs it).

`AssetManifest` reads that manifest once per process and resolves a logical name to
`/assets/build/<hashed>`, which is what the `asset()` template helper calls. A missing or
unreadable manifest, or a name with no entry, falls back to the logical name rather than
throwing — templates keep rendering with an unhashed URL instead of a build hiccup taking the
whole page down.

Alongside `asset()`, `url(path, query)` builds canonical, query-aware URLs and `money(cents)`
takes **integer cents** and formats a display price. All three live on Express's `app.locals`.

### `partials/head.ejs` is the single writer of `<head>` metadata

A page contributes what it knows about itself by setting `page_title`, `page_description` and
related locals before including the head partial; everything it leaves unset falls through to
the configured default. Every `<title>`, description, canonical link, robots tag and social card
is written there and nowhere else.

Single-writer matters most for the indexing directive. When a page passes no `noindex` of its
own, the meta tag falls through to the `seo.robots` directive `SeoMiddleware` resolved — the
same value the response header and the sitemap derive from, so the three cannot disagree. A
funnel step or error page that sets `noindex` explicitly keeps its own answer.

---

## SEO

`src/seo/` has one governing idea: **each decision has exactly one writer, and everything
else derives from it.**

### `RobotsPolicy` — the single indexing decision

Built from `app.seo.robotsRules` (canonical path, optionally ending `*`, to directive) and
`app.seo.discourageIndexing`.

- `directiveFor(path)` returns the directive, or **null** when the path may be indexed
  freely. Null rather than an `index, follow` string, because the absence of a directive is
  what "indexable" means to a crawler.
- `refusesIndexing(path)` asks whether the directive keeps the path out of an index
  altogether. **Having a directive is not the same as being refused** — `noarchive` asks a
  crawler to index and not cache; `nosnippet` asks it to index and quote nothing. Reading
  either as a refusal is not a harmless over-reach: `robots.txt` would translate it into a
  `Disallow`, which blocks the fetch, and a page that is never fetched is never indexed.
- `isIndexable(path)` — what the sitemap filters on — is the **negation of
  `refusesIndexing()`**, not of `directiveFor() === null`, for exactly that reason.
- `indexingDiscouraged()` answers about the deployment rather than any single path, because
  the master switch turns `robots.txt` into a blanket disallow rather than a list of
  exceptions.
- `discourageIndexing` is that master switch, above all of it: when on, every path is refused
  regardless of any per-route rule, so a staging deployment cannot leak into an index through
  one mis-set page. It defaults on outside production.

Rule matching is by specificity, not by config order: an exact path beats a prefix, and a
longer prefix beats a shorter one.

`RobotsPolicy.REFUSED` is `noindex, nofollow` — `nofollow` too, because a noindex page's links
are not endorsements — and it is what `ErrorPresenter` stamps on error responses.

### `MetaResolver` and `PageMeta`

`MetaResolver` builds every page's metadata from configuration and catalog data, so a client
gets correct titles, descriptions, canonical links and social cards without writing code. The
resolution order is the same for every field: **a per-page override, then the page's own data,
then the configured default.** The override layer comes from `config/products.overrides.ts`,
which is what makes it survive a re-sync.

An empty string falls *through* to the next source rather than satisfying the chain — absent and
blank mean the same thing to a crawler, and a synced product with an empty description would
otherwise render `<meta name="description" content="">`.

`PageMeta` is one page's resolved metadata, computed once so the `<title>`, the description,
the canonical link and the social card cannot disagree. `SeoMiddleware` publishes it as the
`seo` template local.

### Structured data

`src/seo/structured-data/` has an emitter per type — `Organisation`, `WebSite`,
`BreadcrumbList`, `Product` — rather than one class switching on a type string, because each
answers a different rule: a `Product`'s offer has to reflect real state, a prescription product
has to be able to publish **nothing at all**, and the site-level nodes have neither constraint.
`Emitter.emit()` returns `null` rather than an empty object, because "nothing to say" and "an
empty object" are different claims to a crawler.

`StructuredData` assembles the graph **from the path** — the same input `RobotsPolicy` decides
indexing from. Each emitter is independently switchable in `app.seo.structuredData`, and each
toggle counts as **off** when absent, so a deployment that has not configured structured data
publishes none. The `rx` toggle ships off: a prescription product carries claims and
availability constraints that vary by jurisdiction.

The `WebSite` node carries a `SearchAction` built from `app.seo.searchUrlTemplate`; when that is
`null` it falls back to `/treatments/?q={search_term_string}`, and an empty string turns the
action off.

### The sitemap derives its exclusions from the robots policy

`SitemapController` carries **no exclusion list of its own.** It asks `RobotsPolicy` — the
same object that decides whether a page emits `noindex`. Two lists would drift, and the
failure mode is silent and bad: a checkout page advertised in a sitemap while claiming to be
unindexable.

Its `STATIC_PATHS` constant lists only the marketing surface, so funnel steps are absent by
construction as well as by policy.

Under `discourageIndexing` the document is still served but lists nothing. A 404 behind a
live `Sitemap:` line in `robots.txt` is a contradiction a crawler will report; an empty
`<urlset>` is the weaker of two imperfect answers.

`RobotsController` generates `robots.txt` from the same policy plus the `app.seo.aiCrawlers`
configuration — whether a client wants their catalog ingested by answer engines is a commercial
decision, not a technical default. Both documents are routed and generated rather than served
as static files, so a re-sync cannot leave them stale; both are file-like paths, which
`CanonicalUrlMiddleware` exempts from the trailing-slash rule.

---

## Testing

`test/` holds Jest specs, run under `NODE_ENV=test`. That one variable is what switches the EMR
gateway family to its Null implementations and installs refusing transports under every payment
adapter, so a test run cannot reach the EMR or a provider by accident; `test/support/no-network.ts`
fails loudly if anything still tries. E2e specs build the app through
`Test.createTestingModule()` and `test/support/test-app.ts`, substituting fakes with
`overrideProvider()`.

Three specs are worth knowing about before changing the shape of anything:

- `test/middleware-ordering.e2e-spec.ts` pins the pipeline order and proves the save-back still
  flushes when a downstream slot redirects.
- `test/support/app-config.spec.ts` proves `NODE_ENV=test` forces every network-touching flag
  off, which is what the "no test reaches the network" guarantee rests on.
- `test/funnel/step-guard.e2e-spec.ts` covers the guard's redirect and fail-closed branches.
