# AsterMD Storefront — NestJS port

A NestJS/TypeScript port of `storefront-lamp` (the PHP/Slim telehealth storefront), being built
phase by phase to match its behavior — the 9-slot middleware pipeline, journey/funnel logic,
checkout order-of-operations, database schema, and Port/Null gateway pattern — while adapting the
toolchain to Node: **Prisma** instead of a hand-rolled query builder, **EJS** instead of Twig,
**class-validator** DTOs at the HTTP boundary in addition to the domain-layer validators the PHP
original already has.

**This is a work in progress, not a finished product.** See [`STATUS.md`](STATUS.md) for exactly
what's built, what's live, and what isn't yet. See [`MERN.md`](MERN.md) for the target
architecture and the reasoning behind every stack decision that departs from the PHP original.

---

## Requirements

| | |
|---|---|
| Node | `>= 22` (`package.json` `engines`, `.nvmrc`) |
| Database | SQLite by default (`prisma/schema.prisma`); Postgres/MySQL are storefront-lamp's supported engines but not yet validated on this port |

## Install

```bash
npm install
cp .env.example .env              # then edit it — see below
npx prisma migrate deploy         # creates the SQLite file and applies migrations
```

`ASTERMD_CLIENT_ID`/`ASTERMD_CLIENT_SECRET`/`ASTERMD_CHANNEL_ID`/`ASTERMD_BASE_HOST` in `.env` are
real EMR credentials, read directly from `process.env` (never committed — `.env` is gitignored).
Leave them unset and `config.app.session.analytics` will still default to on outside
`NODE_ENV=test` (matching storefront-lamp exactly), so a blank/invalid credential pair will surface
as a logged `session.create_failed`/`cart.mirror_request_failed` rather than a crash — the EMR
gateways degrade the same way the PHP originals do.

## Running it

```bash
npm run start:dev     # nest start --watch — dev server on :8080 (PORT in .env)
npm run build         # nest build
npm start             # node dist/src/main.js — the built app
```

```bash
curl -s localhost:8080/health/
```

## Testing

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # eslint
npm test              # jest — unit + e2e specs
```

**No test reaches the network.** `NODE_ENV=test` forces `config.app.session.analytics` and
`config.app.features.emrVerification` off regardless of `.env`, so every EMR-family gateway is
Null-bound under the suite — the same invariant storefront-lamp's own `APP_ENV=test` enforces.

## Console commands

```bash
npm run console -- db:migrate
```

`nest-commander`-based, bootstrapped through the same `AppModule`/`CoreModule` graph as the web
process — no second wiring path. All of storefront-lamp's command set is ported and real —
`npm run console -- <name>`:

| | |
|---|---|
| `db:migrate` | applies pending Prisma migrations |
| `theme:sync [--channel <id>] [--apply]` | pulls the real AsterMD channel's product catalog + payment-processor config, writes `config/products.generated.ts`/`config/channel.generated.ts`. **Read-only without `--apply`** — prints what would change; `--apply` actually overwrites those generated files. Also reports products missing a payment-provider mapping. |
| `emr:ping` / `provider:ping` | connectivity checks against the EMR / the active payment adapter |
| `emr:reconcile` / `provider:reconcile` | forward/reverse order-reconciliation sweeps |
| `payment:capture` | settles a QA-held (pre-auth) order |
| `forms:record --teleform=<id> --out=<dir>` | dumps a real teleform's raw metadata + definition JSON — the ground truth for what a form actually asks, used throughout this port's own debugging rather than guessing at field shapes |
| `forms:cache-purge` | clears the on-disk teleform-definition cache |
| `cache:clear` | clears the EMR bearer-token cache |
| `media:prune` | removes orphaned synced product images |
| `abandonment:signals` | the abandonment-detection sweep |
| `db:prune` | the retention/log-pruning sweep |
| `ops:status` | operational counts (unsynced orders, abandonment, etc.) |
| `config:validate` | validates the loaded config, exit code 2 on error |

See `STATUS.md` for what each one is bound to right now (real vs. Null-backed gateway) and any
known gaps.

## Looking at the database

```bash
npm run db:view     # http://localhost:5959/ — browse every table's latest 200 rows
```

A small standalone dev tool (`build/db-viewer.mjs`, plain Node + `better-sqlite3`, no other
dependency) — a local web page listing every real table (`sessions`, `orders`, `order_lines`,
`events`, `checkout_attempts`, ...) with a tab per table, since this project has no Prisma Studio
support (Studio doesn't work with this port's `better-sqlite3` driver-adapter setup, only with
Prisma's own native `sqlite:`/`postgresql:`/`mysql:` connection strings) and no GUI DB browser
installed by default.

Deliberately **not** started alongside `npm run start:dev` — it's a separate process on its own
port (`5959`, override with `DB_VIEWER_PORT`), started and stopped independently, read-only, and
only useful to a developer poking at real data, never a runtime dependency of the app itself. Points
at `storage/database/app.sqlite3` by default; override with `DB_VIEWER_PATH` for a different file
(e.g. a test run's temp database).

---

## What this talks to

Same as storefront-lamp: **the EMR**, now through the real, official `@astermd-hq/sdk` npm
package (`src/emr/client-factory.ts` builds the shared client; `Emr*Gateway` classes wrap its
`sessions()`/`carts()`/`verification()`/`checkoutEvents()`/`treatments()` resources), gated
real-vs-Null in `src/core/core.module.ts` exactly like storefront-lamp's `AppFactory`. **Payment is
real too** — `Vrio`/`CheckoutChamp` adapters (`src/payment/vrio/`, `src/payment/checkout-champ/`),
chosen per the synced channel's own `payment_processor.provider_category` (`AdapterRegistry`).

## Layout

```
config/          per-deployment behavior config — one .ts file per storefront-lamp config/*.php
prisma/          schema.prisma + generated migrations (replaces storefront-lamp's hand-rolled Migrator)
src/             application code — core/, domain/, emr/, funnel/, journey/, middleware/, routes/, support/
storage/         gitignored; cache (EMR token), logs, sqlite file
test/            Jest unit + e2e specs
views/           EJS templates — pages/ and partials/, no template inheritance (see MERN.md § Templates)
```

## Where everything else is documented

| | |
|---|---|
| [`STATUS.md`](STATUS.md) | live progress tracker — phase status, what's real vs. Null right now, known gaps |
| [`MERN.md`](MERN.md) | target architecture and every stack decision's reasoning |
| [`docs/JOURNEY.md`](docs/JOURNEY.md) | **this port's own doc** — one real customer journey (home → product → cart → intake → checkout → a real placed order) traced end to end, file by file, function by function, with real log/DB evidence at every step |
| [`docs/MIDDLEWARE.md`](docs/MIDDLEWARE.md) | **this port's own doc** — the 9-slot pinned middleware pipeline, slot by slot: business logic, why each sits where it sits, and every real bug found building it |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/OPERATIONS.md`](docs/OPERATIONS.md), [`docs/INTEGRATION-NOTES.md`](docs/INTEGRATION-NOTES.md), [`docs/SPEC-REFERENCE.md`](docs/SPEC-REFERENCE.md) | carried over from storefront-lamp — the behavioral contract this port is matching |

Version: **0.0.1**, matching `storefront-lamp`'s versioning convention.
