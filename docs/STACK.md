# Stack and design decisions

The AsterMD storefront is a server-rendered **NestJS 11** application on **Node 22+**, with
**EJS** templates, **Prisma** over SQLite, **nest-commander** for the console and Tailwind v4 for
the theme. This document records the stack choices and the rules that keep them correct. For how
the funnel, journey store, catalog and gateways fit together, see
[`ARCHITECTURE.md`](ARCHITECTURE.md); for the middleware pipeline slot by slot, see
[`MIDDLEWARE.md`](MIDDLEWARE.md).

A PHP implementation of the same storefront is maintained separately in
[astermd/storefront-lamp](https://github.com/astermd/storefront-lamp).

---

## Stack at a glance

- **Relational storage.** The schema is relational — `orders → order_lines → order_consents` —
  and a `UNIQUE` constraint on `checkout_attempts.idempotency_key` is the entire mechanism that
  stops a double charge. See [Persistence](#persistence).
- **Server-rendered pages.** Every page is rendered by EJS on the server. SEO requirements
  (`robots.txt`, sitemap, structured data, single-writer `<head>` metadata) are simpler to get
  right from a template that runs on the server than from a client-rendered app. There is no
  JavaScript framework in the browser.
- **NestJS for the web layer.** Controllers, services, validation and the container get Nest's
  module system, decorators and `@nestjs/testing`. The one place Nest's defaults would hurt — the
  fixed middleware → guard → interceptor order — is handled by keeping the nine pinned pipeline
  slots as middleware; see [The middleware pipeline](#the-middleware-pipeline).
- **One process.** One Node process in front of a database, plus a cron table for the console
  sweeps. No queue, no separate application server.

---

## Toolchain

| Purpose | Command | Notes |
| --- | --- | --- |
| Node | `node` | `>= 22` (`engines` in `package.json`, `.nvmrc`) |
| Packages | `npm` | lockfile is `package-lock.json` |
| Nest CLI | `nest` | `@nestjs/cli`, pinned in `devDependencies` — do not rely on a global install |
| Tests | `npm test` | Jest, using `@nestjs/testing`'s `Test.createTestingModule()` plus `supertest` |
| Types | `npm run typecheck` | `tsc --noEmit` |
| Lint | `npm run lint` | ESLint over `src/` and `test/` |
| Build | `npm run build` | `nest build` — required; see below |
| Migrations | `npm run console -- db:migrate` | runs `prisma migrate deploy`; see [Persistence](#persistence) |
| Assets | `npm run build:assets` | Tailwind v4 + content hashing; independent of the Nest build |
| Theme watch | `npm run dev:theme` | rebuilds on save; for design work |
| Console | `npm run console -- <command>` | `nest-commander` commands; see below |

- **Check which `node` you are running** (`node -v`) at the start of a session.
- **`nest build` is not optional.** A class missing `@Injectable()`, or a constructor parameter
  Nest cannot resolve, fails at **application bootstrap**, not at compile time — `tsc --noEmit`
  does not catch it. If something breaks only when the app starts, suspect DI wiring before a
  type error.
- **Console commands share the web process's wiring.** `src/console/console.module.ts` imports
  the same `CoreModule` as `AppModule`, so a command sees exactly the same bindings (Null ports
  included) as a request does.
- **Baseline: `npm test` is green before you change anything.**

---

## Request lifecycle

```
HTTP request
  ▼
src/main.ts         bootstrap only — numbered steps below
  ▼
AppModule           imports every feature module; CoreModule is @Global()
  ▼
┌─ error boundaries: Express error handler + Nest global filter (steps 7, 8) ──────┐
│ ┌─ pinned pipeline: cookie-parser, then 9 middleware slots ────────────────────┐ │
│ │ ┌─ Nest routing ───────────────────────────────────────────────────────────┐ │ │
│ │ │ ValidationPipe (DTO) → controller → service(s)                           │ │ │
│ │ │ controller → res.render(template, viewModel) → response                  │ │ │
│ │ └──────────────────────────────────────────────────────────────────────────┘ │ │
│ └──────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────┘
```

`src/main.ts` bootstraps the application and does nothing else:

1. Loads `.env` (`dotenv`) before anything reads `process.env`.
2. `NestFactory.create<NestExpressApplication>(AppModule)`.
3. Serves `public/assets/**` at `/assets/**` (`useStaticAssets`).
4. Sets the `views` directory and the `ejs` view engine.
5. Registers the template helpers `asset()`, `url()` and `money()` on the Express `app.locals`.
6. Installs a global `ValidationPipe({ whitelist: true, transform: true })`.
7. Installs `HttpExceptionFilter` as a Nest global filter — errors from pipes and controllers.
8. Registers an error handler on the raw Express instance — errors from the pinned middleware.
9. Listens on `PORT` (default `8080`).

`AppModule` (plus the modules it imports) is the **only** place that knows how the pieces fit
together; nothing outside a module's own providers reaches into another module's internals.

Controllers are thin: read the request, ask an injected service, render. No controller calls the
EMR or the payment provider directly, and no browser does either — EMR credentials live in
`process.env` on the server and are never sent to the client.

**Request bodies are validated through DTOs.** Every mutating route declares a DTO class next to
its controller (for example `src/routes/cart/dto/add-to-cart.dto.ts`) with `class-validator`
decorators, and the global `ValidationPipe` rejects a malformed body with a 400 before the
controller runs. DTOs check shape and type at the HTTP boundary; the domain validators
(`BuyerValidator`, the intake `AnswerValidator`, `CartRules`) still own every business rule —
territory blocks, prescription-plan requirements, consent recording. Neither replaces the other.

---

## The container: `CoreModule` holds every binding

Ports are **injection tokens** (`src/core/tokens.ts`), not concrete classes, so a controller or
service depends on an interface and never on the real or Null implementation behind it:

```ts
// src/core/tokens.ts (excerpt)
export const SESSION_GATEWAY = Symbol('SessionGateway');
export const CART_GATEWAY = Symbol('CartGateway');
export const PAYMENT_ADAPTER = Symbol('PaymentAdapter');
export const ORDER_RECORDER = Symbol('OrderRecorder');
export const DATABASE_CONNECTION = Symbol('DatabaseConnection');
```

`src/core/core.module.ts` is `@Global()` and binds every token, mostly through factories that
pick the real or Null implementation from config:

```ts
// src/core/core.module.ts (excerpt)
{
  provide: SESSION_GATEWAY,
  useFactory: (config: ConfigService, clients: EmrClientFactory, log: OperatorLog, instr: Instrumentation) =>
    config.app.session.analytics
      ? instr.sessionGateway(new EmrSessionGateway(clients, log))
      : new NullSessionGateway(),
  inject: [ConfigService, EmrClientFactory, OperatorLog, Instrumentation],
},
{
  provide: PAYMENT_ADAPTER,
  useFactory: (registry: AdapterRegistry, config: ConfigService, instr: Instrumentation) =>
    instr.paymentAdapter(
      registry.for(config.payment.adapter ?? channelGenerated.payment_processor.provider_category),
    ),
  inject: [AdapterRegistry, ConfigService, Instrumentation],
},
{ provide: ORDER_RECORDER, useExisting: DatabaseOrderRecorder },
```

**Providers registered in a module are instantiated when that module initialises**, whether or
not anything injects them yet. Do not register a `useFactory` provider before its dependencies
(or its own logic) are ready to run at boot.

**Request-scoped state uses `Scope.REQUEST`.** `JourneyStoreFactory` and `CartStoreFactory` are
request-scoped, so a middleware and a controller that both inject `JourneyStoreFactory` see the
**same** `JourneyStore` for the lifetime of one request:

```ts
// src/journey/journey-store-factory.ts
@Injectable({ scope: Scope.REQUEST })
export class JourneyStoreFactory {
  private store: JourneyStore | null = null;

  constructor(private readonly sessions: SessionRepository) {}

  get(): JourneyStore {
    if (this.store === null) {
      this.store = new JourneyStore(this.sessions);
    }
    return this.store;
  }
}
```

Anything that injects a `Scope.REQUEST` provider becomes request-scoped itself — Nest builds a
fresh injector subtree per request for that branch of the graph.

### The test seam

```ts
const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(SESSION_GATEWAY)
  .useValue(new FakeSessionGateway(/* ... */))
  .compile();

const app = await createTestApp(moduleRef); // test/support/test-app.ts
```

`overrideProvider()` is the substitution seam — Nest's own documented mechanism. There is no
second wiring path: `main.ts` and every test start from `AppModule`, and
`test/support/test-app.ts` repeats `main.ts`'s steps 4–8 so an e2e test gets the same view engine,
helpers, validation and error boundaries as production.

### Ports and their Null counterparts

A Null implementation returns the answer that means "degraded as expected", never a blank one.
See [`ARCHITECTURE.md`](ARCHITECTURE.md#ports-null-implementations-and-the-container-seam) for the
behavioural detail.

| Port | Real | Null |
| --- | --- | --- |
| `SessionGateway` / `CartGateway` / `VerificationGateway` | `Emr*Gateway` | `Null*Gateway` |
| `TeleformGateway` / `IntakeGateway` / `LeadGateway` | `Emr*Gateway` | `Null*Gateway` |
| `IntakeUploads` / `AddressAutofill` / `CouponGateway` | `Emr*` | `Null*` |
| `IdentityGateway` | `EmrIdentityGateway` | `NullIdentityGateway` |
| `PaymentAdapter` | `VrioAdapter` / `CheckoutChampAdapter` / `StripeAdapter` | `NullPaymentAdapter` |
| `OrderRecorder` | `DatabaseOrderRecorder` | `NullOrderRecorder` |
| `CheckoutEventReporter` | `EmrCheckoutEventReporter` | `NullCheckoutEventReporter` |

---

## The middleware pipeline

**The nine pinned slots are registered as Nest middleware, never as guards or interceptors.**
Nest runs guards and interceptors in a fixed position *after* all middleware. If the funnel's
step guard were a `CanActivate` guard, a guard-triggered redirect would happen outside the
journey save-back, and the visitor's state from that request would never be written. Keeping
every slot as middleware lets slot 7 (`JourneySaveBackMiddleware`) wrap slots 8 and 9 and
everything Nest runs after them.

```ts
// src/app.module.ts (excerpt)
configure(consumer: MiddlewareConsumer): void {
  consumer
    .apply(
      cookieParser(), // plain Express middleware; every pinned slot reads req.cookies
      CanonicalUrlMiddleware,
      SeoMiddleware,
      SessionMiddleware,
      RetiredSessionMiddleware,
      AttributionMiddleware,
      CsrfMiddleware,
      JourneySaveBackMiddleware, // wraps everything after it, including StepGuardMiddleware
      StepGuardMiddleware,
      TemplateGlobalsMiddleware,
    )
    .forRoutes('/');
}
```

`forRoutes('/')` is deliberate: Express treats any other path given to `app.use()` as a mount
prefix and rewrites `req.path` for the middleware, so `'*'` would make every slot see `/`.

```
outermost
 1  CanonicalUrlMiddleware      one-hop 301 to the canonical URL form
 2  SeoMiddleware               publishes page metadata; writes X-Robots-Tag
 3  SessionMiddleware           express-session, wrapped as Nest middleware
 4  RetiredSessionMiddleware    clears the analytics cookie of a finished journey
 5  AttributionMiddleware       resolves the analytics session; first-touch capture
 6  CsrfMiddleware              mints the token; rejects unauthenticated mutations
 7  JourneySaveBackMiddleware   writes durable journey state back, once; wraps 8 and 9
 8  StepGuardMiddleware         enforces funnel step preconditions
 9  TemplateGlobalsMiddleware   publishes res.locals before the handler runs
innermost → Nest routing → controller
```

**How slot 7 wraps the rest.** Express's `next()` returns before an async controller has
finished, so `try { await next() } finally { flush() }` would flush too early. Instead,
`JourneySaveBackMiddleware` wraps `res.end` so the response waits for the flush, and also flushes
on `close` for an aborted connection; the flush runs exactly once either way. Nothing downstream
can read this request's session row before its own write has landed. See
[`MIDDLEWARE.md` § 7](MIDDLEWARE.md#7-journeysavebackmiddleware--slot-7-of-9-wraps-8-and-9).

**Slot 8** reads the cart and journey state, matches the step by path from the flow definition
(Nest has not routed the request yet), and either calls `next()` or redirects to the step the
funnel router names. If the router names the step the visitor is already on, it fails closed to
the entry step and logs `funnel.guard_self_redirect`.

### Why the positions are what they are

- Canonicalisation runs before SEO, so metadata is computed for the canonical URL.
- SEO sits outside everything else, so error responses still carry `X-Robots-Tag`.
- The session sits outside CSRF, which needs it to store the token.
- Retired-session sits outside attribution because of `Set-Cookie` ordering.
- CSRF sits outside the save-back, so a rejected mutation writes nothing.
- The save-back sits outside the step guard, for the reason above.
- Template globals are innermost: every mutation response is a redirect and renders nothing.

[`MIDDLEWARE.md`](MIDDLEWARE.md) covers each slot in full.

### Error handling

**Two error boundaries share one `ErrorPresenter`,** because Nest's exception filters only see
exceptions from its own pipe/controller stage, never ones raised inside middleware:

```ts
// src/main.ts (excerpt)
app.useGlobalFilters(new HttpExceptionFilter(errorPresenter)); // pipes, controllers

expressInstance.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  errorPresenter.render(err, req, res); // the pinned middleware
});
```

Both delegate to `src/support/error-presenter.ts`, so the three tiers are defined once:

| Condition | Response |
| --- | --- |
| 404 (no route matched) | `pages/error-404.ejs`; `NotFoundController` (`@All('*splat')`, imported last) throws it |
| a thrown `HttpException` with a 4xx status | `pages/error-http.ejs`, **not logged** |
| anything else | logged to `storage/logs/app.log` with a request id, shown on `pages/error-500.ejs` |

Every error response carries `X-Robots-Tag: noindex, nofollow` (`RobotsPolicy.REFUSED`).

---

## Layout

```
src/
  main.ts            bootstrap only
  app.module.ts      root module; registers the pinned pipeline
  core/              CoreModule (@Global(), every binding) and tokens.ts
  middleware/        the nine pinned slots, one class per file
  routes/            one Nest module + controller per area (cart, checkout, intake, ...)
  domain/            Cart, CartRules, FunnelRouter, ProductCatalog, StepRouter
  funnel/            FlowDefinition, StepPreconditions, funnel rules
  journey/           JourneyState, JourneyStoreFactory, CartStore, SessionResolver
  catalog/           CatalogBuilder, CatalogMerger, CatalogProvider, CatalogValidator
  forms/             intake engine: definitions, answers, DefinitionCache
  checkout/  payment/  upsell/  completion/  verification/
  emr/               EmrClientFactory, the EMR gateway family, CartMirror
  repository/        the only code that touches the database
  database/          ConnectionFactory (PrismaClient + driver adapter)
  seo/               RobotsPolicy, MetaResolver, PageMeta, structured data
  observability/     Instrumentation, the Instrumented* decorators, Boundary
  abandonment/  reconciliation/  retention/   console sweeps
  support/           ConfigService, Url, AssetManifest, OperatorLog, ErrorPresenter, ...
  console/           nest-commander commands; thin wrappers over the services above
views/               EJS: pages/ and partials/
public/
  css/ js/           Tailwind v4 source and browser scripts (build input)
  assets/            fonts, images; assets/build/ is generated and gitignored
config/              site config, funnel table, catalog layers (TypeScript modules)
prisma/              schema.prisma and migrations/
test/                Jest unit and supertest e2e specs, plus test/support/
```

Every feature area is a Nest module (`CatalogModule`, `CheckoutModule`, …) declaring its own
controllers and providers, which makes `Test.createTestingModule({ imports: [CheckoutModule] })`
a useful narrower seam when a test needs only one area.

**`public/assets/build/` is built at deploy time, not committed.** `npm start`'s `prestart` hook
runs `nest build` and `build:assets`, and `npm run console`'s `preconsole` hook runs `nest build`,
so a bare `npm start` on a fresh checkout produces a working app. A pipeline that runs
`npm run build && npm run build:assets` and ships `dist/` plus `public/assets/build/` as
artifacts is an equally valid alternative — as long as exactly one of them runs before the
process starts.

---

## Persistence

- **Prisma.** `prisma/schema.prisma` declares the models and a single fixed `datasource`
  provider (`sqlite`). `PrismaClient` is built by `src/database/connection-factory.ts` with the
  `PrismaBetterSqlite3` driver adapter and bound behind the `DATABASE_CONNECTION` token; feature
  modules never construct it. The CLI reads its own connection string from `prisma.config.ts`.
- **Switching engines is a code change.** Prisma fixes the provider when the client is generated:
  change `datasource.provider`, run `npx prisma generate`, and create a fresh migration history
  against the new engine. Postgres and MySQL are not yet validated.
- **The schema is `schema.prisma`.** There is no hand-written database type; the generated
  client's types are the source of truth. Tables and columns are snake_case (`@map`/`@@map`);
  the client uses camelCase property names.
- **Migrations** live in `prisma/migrations/`, are applied by `prisma migrate deploy` and are
  tracked in Prisma's `_prisma_migrations` table. `npm run console -- db:migrate` runs that
  command from inside a `nest-commander` command.
- **Timestamps are ISO-8601 UTC strings** (`String` fields), not a native `DateTime`. Every writer
  uses the same fixed width, so a plain string comparison is a valid range query.
- **Money is integer cents** everywhere.
- **`checkout_attempts.idempotency_key` is `@unique`** — this one constraint is the double-charge
  defence.

The full schema, table by table, is in [`ARCHITECTURE.md`](ARCHITECTURE.md#the-schema).

---

## Journey state, the funnel and payment

- **Journey state** — `JourneyStoreFactory` is `Scope.REQUEST`, shared between the save-back
  middleware and every controller that injects it, and flushed once per request. The flush is
  gated by a fingerprint comparison, so an unchanged journey writes nothing.
- **The funnel** — `config/funnel.ts` is the step table; `StepGuardMiddleware` enforces it by
  path.
- **Payment** — `PaymentAdapter` is bound behind `PAYMENT_ADAPTER`. `AdapterRegistry` registers
  the `vrio`, `checkout_champ` and `stripe` providers as factories and resolves one from the
  synced channel's payment processor (or the `config.payment.adapter` override); an unknown or
  unbuildable provider resolves to `NullPaymentAdapter`. Checkout runs in a fixed order — flood
  check → re-price → validate buyer → geo gate → store buyer → claim idempotency → charge — and
  everything after the charge runs inside `PostChargeGuard`.

[`ARCHITECTURE.md`](ARCHITECTURE.md) has the behavioural detail: why the guard fails closed on a
self-redirect, when `order_placed` opens, and why nothing may reverse past the charge.

---

## Templates

EJS is one of Express's built-in view engines, so wiring it is two `app.set()` calls. Helpers
that do not vary per request live on `app.locals`, which Express merges into every render:

```ts
// src/main.ts (excerpt)
app.set('views', join(process.cwd(), 'views'));
app.set('view engine', 'ejs');
expressInstance.locals.asset = (name: string) => assetManifest.resolve(name);
expressInstance.locals.url = (path: string, query?: Record<string, string>) =>
  Url.build(path, query);
expressInstance.locals.money = (cents: number) => formatMoney(cents);
```

Values that do vary per request are set on `res.locals` by `TemplateGlobalsMiddleware` (slot 9).

**EJS has no template inheritance** — only `<%- include('partial', data) %>`. Every page template
includes the shared head and footer partials itself and passes the locals they need
(`page_title`, `noindex`, ...). The single-writer `<head>` rule and the robots/structured-data
gating hold as a convention every page follows, not as something a base layout enforces.

---

## Caching

- **Teleform definitions** — `DefinitionCache` (`src/forms/definition-cache.ts`) is a file-backed
  cache under `storage/cache/forms/`, keyed by the form's identifier, with a TTL from
  `config/intake.ts`. It keeps a remote fetch off the critical path of the intake step.
  `forms:cache-purge` clears it.
- **EMR bearer token** — `@astermd-hq/sdk`'s own `FileTokenStore`, wired in
  `src/emr/client-factory.ts` at `storage/cache/emr-token.json`, so the storefront does not
  re-authenticate on every request or console run. `cache:clear` clears it.
- **Asset manifest** — `AssetManifest` reads `public/assets/build/manifest.json` once and keeps it
  for the life of the process.
- **Compiled templates** — Express enables `view cache` by default when `NODE_ENV=production`, so
  each `.ejs` file is compiled once. It is not enabled explicitly elsewhere.

No other caching layer is planned. If a real need appears, treat it as a new decision.

---

## Testing

- **`test/` holds Jest specs**; e2e specs drive the app with `supertest` over
  `Test.createTestingModule()` and `test/support/test-app.ts`.
- **No test may reach the network.** `NODE_ENV=test` forces `app.session.analytics` and the EMR
  verification switches off, binding the EMR gateway family to Null. Payment adapters are chosen
  from channel data, not the environment, so under test each provider gets a refusing transport
  instead. `test/support/no-network.ts` fails loudly if anything still tries to open a socket.
- **`NODE_ENV=test` makes every page `noindex`.** Vary indexing through a config variant rather
  than trusting the default.
- **Pipeline order is tested.** Under `NODE_ENV=test` every pinned slot appends its name to an
  `X-MW-Trace` header, and `test/middleware-ordering.e2e-spec.ts` asserts the order.

---

## Operational traps

- Check reachability with `npm run console -- emr:ping`, never a raw curl at the token endpoint.
- An EMR permission change needs `cache:clear` before it is visible.
- `theme:sync --apply` overwrites `config/products.generated.ts` and
  `config/channel.generated.ts`; both are gitignored.
- Tailwind's `cursor: pointer` fix lives once in the base layer, not per control.
- **Stale `dist/`.** `nest build` output under `dist/` can outlive a renamed provider and start a
  server that binds nothing to the new token. If a DI error does not match the current source,
  delete `dist/` first.
- **Asset manifest cache.** During asset work against one long-running `start:dev` process,
  restart the server after every `build:assets`, or it keeps serving hashed filenames the rebuild
  already deleted.

---

## Rules that protect correctness

- **Commit with explicit paths**, never a bare `git commit`.
- **Grep before building on a summary** — including this document's.
- **Record what a system actually returns before designing against it** — see
  [`INTEGRATION-NOTES.md`](INTEGRATION-NOTES.md).
- **Ask who else touches what you just changed.**
- **Never move a pinned slot from middleware to a Guard or Interceptor** without re-deriving the
  ordering argument in [The middleware pipeline](#the-middleware-pipeline) first.
