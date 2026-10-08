# MERN.md

AsterMD telehealth storefront — a port of the PHP/Slim original onto **NestJS**, backed by
Prisma and EJS. Still called "MERN" as this project's label, for continuity with its
sibling ports (`storefront-lamp` is the PHP original); there is no MongoDB, no React, and — as
of this rewrite — no bare Express either. See [Naming](#naming-this-is-not-literally-mern-and-not-plain-express-either)
for what the label actually means here. Unlike a barebone Express port, NestJS imposes real
shape of its own — modules, dependency injection, a fixed middleware → guard → interceptor
order — so this document is longer than a barebone port would need, because there is more to
decide and more that can go wrong silently.

---

## Naming: this is not literally MERN, and not plain Express either

- **No MongoDB.** The schema is relational — `orders → order_lines → order_consents`, and a
  `UNIQUE` constraint on `checkout_attempts.idempotency_key` is the entire mechanism that stops
  a double charge. That needs a relational engine (Postgres primary; MySQL and SQLite as
  alternatives), the same choice made for the PHP original.
- **No React.** Pages are server-rendered with EJS. Unlike the Nunjucks choice this document
  originally made, EJS does **not** mirror the PHP original's Twig syntax (`extends`/`block`/
  `include`/macros/filters have no EJS equivalent) — every one of the ~65 templates is
  hand-translated to `<% %>`/`<%= %>`/`<%- %>` and EJS's own `include()` calls rather than
  ported mechanically. That trade was made anyway, on request, in exchange for a smaller,
  more ubiquitous templating dependency. What EJS does still deliver: this storefront's SEO
  requirements (`robots.txt`, sitemap, structured data, single-writer `<head>` metadata) stay
  substantially easier to get right from a template that runs on the server than from a
  client-rendered SPA — that half of the original rationale is unchanged.
- **Why NestJS instead of bare Express.** A barebone Express port has one real advantage over
  Nest: Express middleware nests LIFO with no framework-imposed stage boundary, so a
  wrap-and-flush pattern (`journeySaveBack`, below) can sit anywhere in the chain and wrap
  everything inside it, matching Slim's own middleware nesting exactly. Nest gives that up by
  default — guards and interceptors run in a **fixed relative position** after middleware,
  which is what makes "the guard redirected, so the interceptor that would flush journey state
  never ran" a real failure mode. This document's answer to that trade is in
  [The middleware pipeline](#the-middleware-pipeline--kept-as-middleware-on-purpose): the nine
  pinned slots are implemented as Nest **middleware**, not guards or interceptors, which
  sidesteps the fixed ordering entirely and recovers the same fidelity a barebone Express port
  would have — while everything downstream of routing (controllers, services, validation, the
  container) gets Nest's module system, decorators, and `@nestjs/testing` in exchange.
- **What "MERN" means here, in practice:** Node runtime, NestJS web layer, relational storage,
  no templating framework beyond EJS. If a real MongoDB or React need shows up later,
  treat it as a new decision to make deliberately — not something this document already
  assumes.

---

## Toolchain

| Purpose | Command | What it has to be |
| --- | --- | --- |
| Node | `node` | `>= 24` |
| Packages | `npm` | lockfile is `package-lock.json` |
| Nest CLI | `nest` | `@nestjs/cli`, pinned in `devDependencies` — do not rely on a global install |
| Tests | `npm test` | Jest, driven by `@nestjs/testing`'s `Test.createTestingModule()` plus `supertest` |
| Types | `npm run typecheck` | `tsc --noEmit` |
| Build | `npm run build` | `nest build` — **there is a real build step here**, unlike a barebone Express port; Nest needs `emitDecoratorMetadata` applied to every `@Injectable()`/`@Controller()`, which `tsc --noEmit` alone does not verify end-to-end |
| Migrations | `npm run console -- db:migrate` | shells out to Prisma's own migration runner (`prisma migrate deploy`), tracked in Prisma's `_prisma_migrations` table — see [Persistence](#persistence) |
| Assets | `npm run build:assets` | Tailwind v4 + content hashing; run last, after the final template edit; independent of the Nest build |
| Theme watch | `npm run dev:theme` | rebuilds on save; design work only, never for a commit |
| Console | `npm run console -- <command>` | `bin/console` equivalents — migrations, `theme:sync`, sweeps, `emr:ping` — built on `nest-commander` so every command runs inside the **same** Nest application context as the web process, not a second bootstrap path |

- **Establish which `node` you're getting, once, before trusting it.** `node -v` at session
  start.
- **`nest build` is not optional here.** A class missing `@Injectable()`, or a constructor
  parameter Nest can't resolve, fails at **application bootstrap**, not at compile time —
  `tsc --noEmit` is silent about it. If something only breaks when the app actually starts and
  not under `tsc`, suspect DI wiring, not a type error.
- **Baseline: `npm test` is green before you change anything.**

---

## Request lifecycle

```
  nginx
      │  everything that is not a built asset → the Node process
      ▼
  src/main.ts
      │  1. const app = await NestFactory.create<NestExpressApplication>(AppModule)
      │  2. app.set('views', join(process.cwd(), 'views'))
      │  3. app.set('view engine', 'ejs')
      │  4. app.useGlobalFilters(new HttpExceptionFilter())   ← catches errors from guards/pipes/controllers
      │  5. app.use(expressErrorBoundary)                     ← catches errors from the pinned middleware, registered raw
      │  6. await app.listen(port)
      ▼
  AppModule
      │  imports every feature module; CoreModule (see below) is @Global()
      │  and is the one place every port-to-implementation binding lives
      ▼
  ┌─ error boundaries (two, sharing one ErrorPresenter — see Error handling) ──────────────┐
  │ ┌─ the pinned pipeline (9 slots, registered as middleware, nested exactly like Slim) ─┐ │
  │ │ ┌─ Nest routing: guards → interceptors (pre) → pipes → controller → interceptors ─┐ │ │
  │ │ │  (post)                                                                          │ │ │
  │ │ │  controller  →  res.render(template, viewModel)  →  response                    │ │ │
  │ │ └───────────────────────────────────────────────────────────────────────────────┘ │ │
  │ └─────────────────────────────────────────────────────────────────────────────────────┘ │
  └───────────────────────────────────────────────────────────────────────────────────────────┘
```

`src/main.ts` holds bootstrap and nothing else — the same discipline `public/index.php` and
`AppFactory` split between them in the original. `AppModule` (plus the modules it imports) is
the **only** place allowed to know how the pieces fit together; nothing outside a module's own
providers reaches across to another module's internals.

Controllers are thin: read the request, ask an injected service, render. No controller calls
the EMR or the payment provider directly, and no browser ever does either — EMR credentials
live in `process.env` on this server and are never sent to the client.

**Request bodies are validated through DTOs, not inline checks.** Every mutating route (cart
add/remove/quantity, checkout, intake, upsell — as each phase builds it) declares a DTO class
under that feature's own directory (e.g. `routes/cart/dto/add-to-cart.dto.ts`), annotated with
`class-validator` decorators (`@IsString()`, `@IsInt()`, `@Min()`, ...), and a global
`ValidationPipe` (`app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))`,
set once in `main.ts`) rejects a malformed body with a 400 before it reaches the controller. This
is additive to the PHP original's own validation (`BuyerValidator`, the intake `AnswerValidator`,
`CartRules`' own gates) — the DTO layer catches shape/type errors at the HTTP boundary; the
domain-layer validators still own every business rule this document describes elsewhere
(territory blocks, rx-plan requirements, consent recording, ...), and neither replaces the other.

---

## The container is Nest's own DI — `CoreModule` is where every binding lives

Nest's built-in IoC container replaces the plain object-of-closures a barebone Express port
would need to hand-roll. Ports are **injection tokens**, not concrete classes, so a controller
or service depends on an interface the same way the PHP original's PHP-DI bindings did:

```ts
// core/tokens.ts
export const SESSION_GATEWAY = Symbol('SessionGateway');
export const CART_GATEWAY = Symbol('CartGateway');
export const ORDER_RECORDER = Symbol('OrderRecorder');
export const PAYMENT_ADAPTER = Symbol('PaymentAdapter');
export const DATABASE_CONNECTION = Symbol('DatabaseConnection');
// …one token per port
```

```ts
// core/core.module.ts
@Global()
@Module({
  providers: [
    {
      provide: DATABASE_CONNECTION,
      useFactory: (config: ConfigService) => createConnection(config),
      inject: [ConfigService],
    },
    {
      provide: SESSION_GATEWAY,
      useFactory: (config: ConfigService) =>
        config.get('app.session.analytics') ? new EmrSessionGateway(buildEmrClient(config)) : new NullSessionGateway(),
      inject: [ConfigService],
    },
    {
      provide: CART_GATEWAY,
      useFactory: (config: ConfigService, emr) =>
        config.get('app.session.analytics') ? new EmrCartGateway(emr) : new NullCartGateway(),
      inject: [ConfigService, EMR_CLIENT],
    },
    { provide: ORDER_RECORDER, useClass: DatabaseOrderRecorder },
    {
      provide: PAYMENT_ADAPTER,
      useFactory: (registry: AdapterRegistry) => registry.resolve(),
      inject: [AdapterRegistry],
    },
    // …every other port
  ],
  exports: [SESSION_GATEWAY, CART_GATEWAY, ORDER_RECORDER, PAYMENT_ADAPTER, DATABASE_CONNECTION /* … */],
})
export class CoreModule {}
```

**Every value is built once, at module instantiation, from a factory or class provider — the
same "every container binding is a closure" rule the PHP original states in
`docs/ARCHITECTURE.md § Lazy by construction`.** Nest resolves each provider lazily on first
injection by default (a provider nothing depends on is never constructed), which is the direct
equivalent of the PHP container's laziness.

**Request-scoped state uses `Scope.REQUEST`, Nest's first-class equivalent of "attach it to
`req` and read it off `req` everywhere else":**

```ts
@Injectable({ scope: Scope.REQUEST })
export class JourneyStoreFactory {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: PrismaClient,
    @Inject(REQUEST) private readonly req: Request,
  ) {}

  get(): JourneyStore {
    return new JourneyStore(this.db, this.req.session);
  }
}
```

Anything injecting a `Scope.REQUEST` provider becomes request-scoped itself — Nest builds a
fresh injector subtree per request for that branch of the graph — so a controller and a
middleware that both inject `JourneyStoreFactory` see the **same instance** for the lifetime of
one request, matching the PHP container's "closure resolves to one instance per container"
guarantee for `JourneyStore` and `CartStore`.

### The seam

```ts
const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(SESSION_GATEWAY)
  .useValue(new FakeSessionGateway({ mintUuid: SESSION }))
  .compile();

const app = moduleRef.createNestApplication<NestExpressApplication>();
await app.init();
```

`Test.createTestingModule(...).overrideProvider(...)` **is** the substitution seam, and it is
Nest's own documented mechanism rather than something bolted on — the direct equivalent of
`AppFactory::create($root, $overrides)` in the PHP original. There is no second wiring path:
production bootstrap (`main.ts`) and every test both start from `AppModule`.

### Ports and their Null counterparts

Same ten, same reasoning as the PHP original — see the PHP `docs/ARCHITECTURE.md` §
"Ports, Null implementations, and the container seam" for the full behavioural rationale (a
Null implementation returns the answer that means "degraded as expected," never a blank one).
Nothing about the Nest port changes *which* ports exist or what their Null twins do — only how
they're bound (a Nest provider token instead of a container property or a PHP-DI binding).

| Port | Real | Null |
| --- | --- | --- |
| `SessionGateway` / `CartGateway` / `VerificationGateway` | `Emr*Gateway` | `Null*Gateway` |
| `TeleformGateway` / `IntakeGateway` / `LeadGateway` | `Emr*Gateway` | `Null*Gateway` |
| `IdentityGateway` | `EmrIdentityGateway` | `NullIdentityGateway` |
| `PaymentAdapter` | `VrioAdapter` | `NullPaymentAdapter` |
| `OrderRecorder` | `DatabaseOrderRecorder` | `NullOrderRecorder` |
| `CheckoutEventReporter` | `EmrCheckoutEventReporter` | `NullCheckoutEventReporter` |

---

## The middleware pipeline — kept as middleware, on purpose

This is the answer to the trade-off named in
[Naming](#naming-this-is-not-literally-mern-and-not-plain-express-either): **the nine pinned
slots are registered as Nest middleware, never as guards or interceptors**, specifically so the
pipeline still nests the way Slim's does and the way a barebone Express port's would. Nest's
`MiddlewareConsumer` registers plain Express-shaped middleware — `(req, res, next)` — ahead of
Nest's own guard → interceptor → pipe → controller stage, and because platform-express Nest
still dispatches middleware through Express's own chaining, a middleware that does
`try { await next() } finally { ... }` wraps **everything downstream of it**, guards and
interceptors included, exactly as it would in plain Express.

```ts
// app.module.ts
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(
        canonicalUrl,
        seo,
        session,
        retiredSession,
        attribution,
        csrf,
        journeySaveBack,   // wraps everything after it, including stepGuard
        stepGuard,
        templateGlobals,
      )
      .forRoutes('*');
  }
}
```

```
outermost
    │
 1  canonicalUrl            one-hop 301 to the canonical URL form
 2  seo                     publishes page metadata; writes X-Robots-Tag
 3  session (express-session, wrapped as Nest middleware)
 4  retiredSession          clears the analytics cookie of a finished journey
 5  attribution             resolves the analytics session; first-touch capture
 6  csrf                    mints the token; rejects unauthenticated mutations
 7  journeySaveBack         writes durable journey state back, once — wraps 8
 8  stepGuard               enforces funnel step preconditions — a middleware, not a Nest Guard
 9  templateGlobals         publishes res.locals before the handler runs
    │
    ▼
 Nest routing: guards → interceptors → pipes → controller
```

`journeySaveBack` is an ordinary Nest middleware — a class implementing `NestMiddleware`, or a
plain function consumed the same way — that calls `next()` and then does its work **after**
`next()` returns:

```ts
@Injectable()
export class JourneySaveBackMiddleware implements NestMiddleware {
  constructor(private readonly journeyStores: JourneyStoreFactory) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const store = this.journeyStores.get();
    (req as any).journeyStore = store;
    try {
      await next();               // runs stepGuard, templateGlobals, Nest's guard/interceptor/controller chain — everything
    } finally {
      await store.flush();        // runs even if stepGuard redirected, or the handler threw
    }
  }
}
```

**This is the fidelity a Nest port has to work to keep.** A Nest port that instead implemented
`stepGuard` as a `CanActivate` guard would reproduce the exact failure mode the PHP original's
`docs/ARCHITECTURE.md` warns a Nest-shaped port into: guards run in a fixed position **after**
all middleware, so a guard-redirected visitor's journey state would never reach a `finally`
block sitting in middleware, because middleware's `next()` call returns normally the moment the
guard short-circuits — there is nothing left downstream to flush. Keeping `stepGuard` as a
middleware avoids that failure mode entirely rather than compensating for it after the fact.

`stepGuard` itself reads `journeyStore`/`cartStore` off `req`, decides, and either calls
`next()` or issues the redirect itself:

```ts
@Injectable()
export class StepGuardMiddleware implements NestMiddleware {
  constructor(private readonly funnelRouter: FunnelRouter) {}

  use(req: Request, res: Response, next: NextFunction) {
    const decision = this.funnelRouter.decide(req.path, (req as any).journeyStore.state());
    if (decision.allowed) return next();
    if (decision.target === currentStep(req.path)) {
      this.logger.warn('funnel.guard_self_redirect', { path: req.path });
      return res.redirect(303, FlowDefinition.pathFor(FlowDefinition.ENTRY_STEP));
    }
    res.redirect(303, FlowDefinition.pathFor(decision.target));
  }
}
```

### Why the positions are what they are

Unchanged from the PHP original — see its `docs/ARCHITECTURE.md` § "Why the positions are what
they are" for the full reasoning (canonicalisation before SEO; SEO outside everything so error
responses still carry the header; session outside CSRF; retired-session outside attribution
because of `Set-Cookie` ordering; CSRF outside the save-back so a rejected mutation writes
nothing; save-back outside the guard for the reason demonstrated above; template globals
innermost because every mutation response is a 303 and renders nothing itself). None of that
reasoning is framework-specific, and none of it changes because the slots are now Nest
middleware instead of PHP-DI-wrapped Slim middleware.

### Error handling

**Two error boundaries, sharing one `ErrorPresenter`, because Nest's own exception-filter
mechanism only sees exceptions raised from its own guard → interceptor → pipe → controller
stage — never ones raised inside the pinned middleware.**

```ts
// registered on the raw Express instance, catches the pinned middleware's errors
app.getHttpAdapter().getInstance().use(
  (err: Error, req: Request, res: Response, next: NextFunction) => errorPresenter.render(err, req, res),
);

// registered as a Nest global filter, catches guard/pipe/controller errors
app.useGlobalFilters(new HttpExceptionFilter(errorPresenter));
```

Both delegate to the same `ErrorPresenter` so the three tiers below are defined **once**:

| Condition | Response |
| --- | --- |
| 404 (no route matched) | themed `pages/error-404.ejs`, handled by a catch-all route since Nest's router doesn't throw the way Slim's does |
| a thrown `HttpException` with a 4xx status | themed `pages/error-http.ejs`, **not logged** |
| anything else | logged to `storage/logs/app.log` with a request id, same id shown on `pages/error-500.ejs` |

Every error response carries `X-Robots-Tag: noindex, nofollow` from `RobotsPolicy.REFUSED`.

---

## Layout

```
src/
  main.ts                bootstrap only
  app.module.ts           the root module — imports every feature module
  core/
    core.module.ts        @Global() — every port-to-implementation binding lives here
    tokens.ts              injection tokens for every port
  middleware/             the nine pinned pieces, one class per file, in the folder
  routes/                 one Nest module + controller per funnel area
  domain/                 Cart, CartRules, FunnelRouter, FlowDefinition, StepPreconditions
  journey/                JourneyState, JourneyStoreFactory, CartStore, SessionResolver
  catalog/                CatalogBuilder, CatalogMerger, CatalogProvider, CatalogValidator
  forms/ verification/ checkout/ payment/ upsell/ completion/
  emr/                    EmrClientFactory, the gateway family, CartMirror
  repository/             the only code that touches the database
  database/               connection-factory.ts, schema.ts (hand-written DB type), migrations/
  seo/                    RobotsPolicy, MetaResolver, PageMeta, structured-data/
  observability/          Instrumentation, the Instrumented* decorators, Boundary
  support/                Config, Url, AssetManifest, OperatorLog, CardScrubber, RateLimiter
  console/                nest-commander CLI commands — thin wrappers over the services above,
                           run inside the same application context as the web process
views/                    EJS: layouts/, pages/, partials/ — client-owned
public/
  css/ js/                Tailwind v4 source, browser scripts
  assets/build/           content-hashed output, gitignored — built at deploy time, not committed
config/                   site config, funnel table, catalog layers — TypeScript modules
test/                     supertest HTTP tests over Test.createTestingModule(), plus test/support/
```

Every feature area is a real Nest module (`CatalogModule`, `CheckoutModule`, …), each declaring
its own controllers and providers and importing `CoreModule` for the ports it needs — closer to
the PHP original's per-namespace organisation under `core/` than a single flat `routes/`
directory would be, and it is what makes `Test.createTestingModule({ imports: [CheckoutModule] })`
a meaningful narrower seam when a test only needs one area.

**`public/assets/build/` reverses storefront-lamp's own convention, on request.** The PHP original
commits its built assets because its deployment model never runs Node on the server at all — `npm
run build` is a step a developer runs locally before committing, and `public/index.php` serves
whatever hashed files happen to be sitting in git. This port initially copied that convention
verbatim (see git history), but it fits a Node deployment poorly: committing a `dist/`-shaped build
artifact is exactly what `.gitignore` exists to prevent, and this app's own runtime already needs
Node installed to run at all, so requiring it again to produce the asset build first is not an extra
dependency the way it would be for a PHP host. The build now runs at deploy time instead: `npm
start`'s `prestart` hook (and `npm run console`'s `preconsole` hook) run `nest build` — and, for
`prestart` only, `build:assets` too — automatically, so a bare `npm start` on a fresh checkout with
no prior build produces a fully working app. There is no CI/CD pipeline in this repository yet; if
one is added later, running `npm run build && npm run build:assets` as a build step and shipping
`dist/`+`public/assets/build/` as deploy artifacts is an equally valid alternative to relying on the
`prestart` hook, and either is fine as long as exactly one of them runs before the process starts.

---

## Persistence

Departs from the PHP original's decision, on request:

- **Prisma, not Kysely.** `prisma/schema.prisma` declares the models and a single fixed
  `datasource` provider (`sqlite` in this project's default); `PrismaClient` is generated from
  it and bound in `CoreModule` behind the `DATABASE_CONNECTION` token, not imported directly by
  feature modules. This document previously chose Kysely specifically because Prisma fixes its
  provider at schema-compile time — switching engines means changing `datasource.provider` in
  `schema.prisma` and re-running `prisma generate` (and a fresh `prisma migrate dev` against the
  new engine), not flipping a runtime config value the way `PostgresDialect`/`MysqlDialect`/
  `SqliteDialect` let Kysely do. That limitation is accepted now, in exchange for Prisma's
  generated, fully-typed client and its own migration tooling.
- **No hand-written `DB` interface.** `schema.prisma` *is* the schema; `PrismaClient`'s
  generated types replace what `database/schema.ts` (Kysely) used to hand-declare. Column names
  are still snake_case in the underlying tables (`@map(...)`/`@@map(...)` on every field/model)
  — unchanged from the original — with idiomatic camelCase property names on the generated
  client.
- **Migrations are Prisma's own**, under `prisma/migrations/`, applied via `prisma migrate
  deploy` and tracked in Prisma's `_prisma_migrations` table. This replaces the original's
  hand-rolled `Migrator` (and this project's own earlier filename-tracked migration set)
  entirely — migration history is now whatever `prisma migrate dev` generated from
  `schema.prisma`'s evolution, not a hand-authored, per-dialect-branching file per change.
  `npm run console -- db:migrate` shells out to the Prisma CLI from inside a `nest-commander`
  command so the operational entry point is unchanged even though the mechanism underneath it
  is not the original's DI-shared connection.
- **Timestamps are still `VARCHAR(32)` ISO-8601 UTC strings**, not a native `DateTime` type —
  modeled as `String` fields in `schema.prisma`, so the original's lexicographic-sort trick (a
  plain string comparison is a valid range query, because every writer uses the same fixed
  width) survives verbatim.
- **`checkout_attempts.idempotency_key` is `@unique`** — this one constraint is the entire
  double-charge defence, and the reason the database is relational at all rather than MongoDB.

Full schema table: see the PHP original's `docs/ARCHITECTURE.md § The schema` — the columns are
unchanged; only the query layer (and, within that, the migration mechanism) differs.

---

## Journey state, the funnel, and payment

These three carry over from the PHP original **with no framework-driven departure**, because
[the middleware pipeline decision above](#the-middleware-pipeline--kept-as-middleware-on-purpose)
already absorbed the one place Nest's fixed ordering would otherwise have forced one:

- **Journey state** — `JourneyStoreFactory` is `Scope.REQUEST`, resolved once per request and
  shared between the `journeySaveBack` middleware and every controller that injects it; flushed
  once in that middleware's `finally`, gated by the same fingerprint comparison as the original
  so an unchanged journey writes nothing.
- **The funnel** — `config/funnel.ts` is the step table, unchanged in shape from the PHP
  original; `StepGuardMiddleware` enforces it, matching by path exactly as the original does.
- **Payment** — `PaymentAdapter` is an interface bound behind the `PAYMENT_ADAPTER` token,
  `AdapterRegistry` resolves the provider category from synced channel data (never a code path),
  `VrioAdapter` is the one shipped implementation, and the checkout order-of-operations (flood
  check → re-price → validate buyer → geo gate → store buyer → claim idempotency → charge →
  `PostChargeGuard` for everything after) is unchanged.

For the full behavioural detail on any of these three — why the guard fails closed on a
self-redirect, why `order_placed` opens where the questionnaire gates shut, why nothing may
reverse past the charge — see the PHP original's `docs/ARCHITECTURE.md`; nothing here changes it.

---

## Templates

EJS — one of `NestExpressApplication`'s natively-supported view engines, so wiring it is a
couple of `app.set()` calls rather than the manual `nunjucks.configure(...)` this document used
to show:

```ts
const app = await NestFactory.create<NestExpressApplication>(AppModule);

app.set('views', join(process.cwd(), 'views'));
app.set('view engine', 'ejs');

// EJS has no Nunjucks-style addFilter()/addGlobal() — a helper is just a function sitting in
// the template's local scope. app.locals persist across requests and Express merges them into
// every render's locals, which is the right lifetime for helpers that don't vary per request;
// TemplateGlobalsMiddleware (pinned slot 9) still sets res.locals per request for values that do.
app.locals.money = (cents: number) => Totals.dollars(cents);
app.locals.asset = (name: string) => assetManifest.resolve(name);
app.locals.url = (path: string, query?: Record<string, string>) => Url.build(path, query);
```

**What EJS's lack of template inheritance costs, concretely.** Nunjucks/Twig's `{% extends %}` +
`{% block %}` let a page declare only what differs from its layout; EJS has no equivalent, only
`<%- include('partial', data) %>`. Every page template now explicitly includes its layout's head
and footer partials and passes down whatever the layout needs (`page_title`, `noindex`, ...) as
locals — the single-writer `<head>` rule and the robots/structured-data gating survive, but as a
convention every page template has to follow (include the same head partial, pass the same
locals) rather than something the layout enforces structurally by being extended. See the PHP
original's `docs/ARCHITECTURE.md § The theme` for the behavioural detail (still unchanged); the
templating mechanics section of that document no longer describes this port.

---

## Caching

The PHP original has three caches, of three different kinds, and this port's stance on each is
different — worth stating once here instead of leaving it scattered:

- **`DefinitionCache`** (`core/Forms/DefinitionCache.php`) — a file-backed cache of teleform
  (intake questionnaire) definitions, keyed by the form's `form_json_identifier` (SHA-256-hashed
  into a filename), with a TTL backstop. It exists because fetching a definition from a signed
  remote URL on every render would put a third-party round trip on the critical path of the
  funnel's highest-abandonment step. **Ported in Phase 6**, alongside `TeleformSource` and the rest
  of the intake engine — see that phase's file list (`src/forms/definition-cache.ts`).
- **The EMR bearer-token cache** (`storage/cache/emr-token.json`, ~24h lifetime) — avoids
  re-authenticating with the EMR on every request. **Built, via `@astermd-hq/sdk`'s own
  `FileTokenStore`** (the same package's PHP-side equivalent storefront-lamp already uses), wired
  in `src/emr/client-factory.ts` at the same path storefront-lamp uses. Not a custom port — an
  earlier draft of this port built its own from-scratch `TokenCache` before the real npm SDK's own
  `FileTokenStore` was found to already do exactly this, atomically and best-effort-degrading the
  same way; the custom version was deleted once the real one was wired in, rather than keeping two.
- **Twig's template-compilation cache** — a Twig-internal feature, not custom code. EJS has its own
  equivalent (`view cache` in Express, backed by `ejs`'s internal compiled-function cache) but it
  is not explicitly enabled in this port yet; Express only turns it on by default when
  `NODE_ENV=production`; the effect is compiling each `.ejs` file to a JS function once instead of
  per-render; skipped in this build for the same reason `watch: true`-style dev conveniences
  usually are — worth a deliberate look once the template set is closer to its final ~65 files
  (Phase 9), not now.

No other caching layer is planned. If a real need shows up later — an expensive catalog
computation, a repeated EMR-shaped lookup once a real gateway exists — treat it as a new decision
to make deliberately, the same way this document treats a real MongoDB or React need.

---

## Testing

- **`test/` holds HTTP tests driven by `supertest` against a `Test.createTestingModule()`
  build.** This is Nest's own documented seam, not a substitute for one — `overrideProvider()`
  replaces `AppFactory::create($root, $overrides)` from the PHP original.
- **No test may reach the network.** `NODE_ENV=test` forces `app.session.analytics = false`,
  binding the whole EMR gateway family to Null inside `CoreModule`'s factories. `PaymentAdapter`
  is not environment-switched — tests get a real adapter over a transport that refuses to send.
- **A questionnaire test needs the same three overrides and cookie the original documents**:
  a session gateway that mints, a teleform gateway serving the definition under test, a fresh
  temp-dir definition cache, and the session cookie on every request.
- **`NODE_ENV=test` makes every page `noindex`.** Vary it through a config variant, same pattern
  as the original, rather than trusting the default to prove anything about indexing.

---

## Operational traps

Carried over unchanged from the PHP original — reachability is a `console -- emr:ping`, never a
raw curl at the token endpoint; an EMR permission change needs a `cache:clear` before it's
visible; `theme:sync --apply` overwrites the two gitignored generated config files; Tailwind's
`cursor: pointer` fix lives once in the base layer, not per-control. **Not** carried over: PHP's
"run `build:assets` last, before committing" discipline no longer applies now that
`public/assets/build/` is gitignored and built at deploy time (see "Layout") — there is nothing to
commit there at all, so the ordering concern that guidance protected against doesn't arise. Two
new to this port: **`nest build` caches
compiled output under `dist/`** — a stale `dist/` from before a provider was renamed can start a
server that resolves the old token and silently binds nothing to the new one; when a DI error
doesn't match the current source, delete `dist/` before assuming the wiring is wrong. **`AssetManifest.resolve()` caches its `manifest.json` read for the life of the Node
process** — correct for production (a deploy always rebuilds and restarts), but during iterative
asset work against one long-running `start:dev` process it means the dev server must be restarted
after every `build:assets` run, or it keeps serving hashed filenames the rebuild already deleted.

---

## Rules that protect correctness

- **Commit with explicit paths on both halves**, never a bare `git commit`.
- **Grep before building on a summary** — including this file's summaries of the original.
- **Record what a system actually returns before designing against it** — carry forward
  `docs/INTEGRATION-NOTES.md` from the original unchanged.
- **Ask who else touches what you just changed.**
- **Never move one of the nine pinned slots from middleware to a Guard or Interceptor** without
  re-deriving the ordering argument in
  [The middleware pipeline](#the-middleware-pipeline--kept-as-middleware-on-purpose) first —
  that decision is the entire reason this port doesn't inherit the failure mode the PHP
  original warns a naive Nest port into.
