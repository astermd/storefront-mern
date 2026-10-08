# AsterMD Storefront (Node / NestJS)

A server-rendered storefront for telehealth. It carries a visitor from a product page to a paid,
clinically-reviewable order: catalog and cart, a definition-driven intake questionnaire, an optional
identity check, checkout against a payment aggregator, post-purchase upsells, and a receipt.

Node 22+ on **NestJS 11**, **EJS** templates, **Prisma** over SQLite, **nest-commander** for the CLI,
and Tailwind v4 for the theme. No JavaScript framework on the client, no queue, no separate
application server: one Node process in front of a database, plus a cron table.

It is a port of the PHP/Slim storefront and keeps its behaviour — the nine-slot middleware pipeline,
the journey/funnel logic, the checkout order of operations, the database schema and the Port/Null
gateway pattern — while using Node-native tooling where that makes sense.

> **Why "MERN"?** The project label is historical. There is no MongoDB and no React: storage is
> relational and pages are server-rendered. See [`MERN.md`](MERN.md#naming-this-is-not-literally-mern-and-not-plain-express-either).

It talks to two external systems:

- **the EMR**, through the official `@astermd-hq/sdk` — product catalog, analytics sessions, teleform
  (questionnaire) definitions, intake submissions and checkout-funnel events;
- **a payment aggregator**, through `@astermd-hq/vrio-client` or `@astermd-hq/checkoutchamp-client`,
  chosen per the synced channel's payment processor — the charge itself, promotions, and the
  reference order that later upsell charges reuse.

The two are kept apart on purpose. **Card data reaches the payment adapter and nothing else.** It is
never sent to the EMR and never written to this application's database.

---

## Features

- Product catalog, cart and cross-sells, with several prescriptions allowed in one order
- Intake questionnaire rendered from EMR teleform definitions
- Optional identity verification step
- Checkout with an idempotency key (a `UNIQUE` constraint is what prevents a double charge)
- Post-purchase upsells and a receipt page
- SEO: `robots.txt`, sitemap, structured data, per-route indexing rules
- Console commands for catalog sync, reconciliation, pruning and ops reporting
- Real EMR and payment integrations behind ports, with Null implementations so tests never touch
  the network

## Requirements

| | |
|---|---|
| Node | `>= 22` (see `engines` in `package.json`, `.nvmrc`) |
| npm | any current version |
| Database | SQLite by default (`prisma/schema.prisma`). Postgres/MySQL are not yet validated on this port. |

## Quick start

```bash
npm install
cp .env.example .env              # then edit it, see Configuration below
npx prisma migrate deploy         # creates the SQLite file and applies migrations
npm run build:assets              # compiles the Tailwind theme
npm run start:dev                 # dev server with watch, http://localhost:8080
```

Check it came up:

```bash
curl -s localhost:8080/health/
```

Production-style run (builds the app and the assets, then starts it):

```bash
npm start                         # prestart runs `npm run build && npm run build:assets`
```

---

## Configuration

Two layers. `.env` holds credentials and per-environment values. `config/*.ts` holds behaviour, and
it is meant to be read: settings carry doc comments explaining not just what they do but why.

### Environment variables

`.env.example` is the starting point. The ones you will touch first:

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `production`, `test`, or anything else for development. Outside `production` the whole site is `noindex`. |
| `PORT`, `APP_URL` | listen port and public base URL |
| `DATABASE_URL` | Prisma connection string (SQLite file by default) |
| `SESSION_SECRET` | signs the session cookie. **Set a real value in every real environment.** |
| `ASTERMD_CLIENT_ID`, `ASTERMD_CLIENT_SECRET` | EMR API credentials, issued to your deployment |
| `ASTERMD_BASE_HOST`, `ASTERMD_CHANNEL_ID` | which EMR host and sales channel this storefront sells |
| `AMD_TRACKING_KEY` (+ `_PREVIOUS`) | affiliate-link payload key, issued to you; leave empty if unused |
| `PATIENT_PORTAL_URL` | optional "manage your care" links |
| `GOOGLE_MAPS_API_KEY` | optional receipt map |
| `EMR_VERIFICATION`, `VERIFICATION_ENABLED` | optional verification features, both off by default |
| `WIRE_LOG` | logs every EMR/provider call **unredacted**. Never enable on a real deployment. |

Real credentials live only in `.env`, which is gitignored. With the EMR credentials blank, the
gateways degrade gracefully (logged errors instead of a crash).

### Generated vs. hand-edited config

`npm run console -- theme:sync --apply` regenerates `config/products.generated.ts` and
`config/channel.generated.ts` from the EMR channel. Both are one channel's data and the second holds
payment-provider credentials, so **both are gitignored and must never be committed.** Sync is a dry
run unless you pass `--apply`.

---

## Running it

```bash
npm run start:dev     # nest start --watch, http://localhost:8080
npm run build         # nest build
npm start             # build + assets, then node dist/src/main.js
npm run dev:theme     # rebuild CSS/JS on save, for design work
```

### Console commands

```bash
npm run console -- <command>
```

| Command | What it does |
|---|---|
| `db:migrate` | applies pending Prisma migrations |
| `theme:sync [--channel <id>] [--apply]` | pulls the channel's catalog and payment config. Dry run without `--apply`. |
| `config:validate` | validates the loaded config; **exit code 2** on error |
| `emr:ping` / `provider:ping` | connectivity checks against the EMR / the payment adapter |
| `emr:reconcile` / `provider:reconcile` | reconciliation sweeps |
| `payment:capture` | settles an order that was authorized rather than charged |
| `forms:record --teleform=<id> --out=<dir>` | dumps a teleform's raw metadata and definition |
| `forms:cache-purge` | clears the teleform-definition cache |
| `cache:clear` | clears the EMR bearer-token cache |
| `media:prune` | removes orphaned synced product images |
| `abandonment:signals` | abandoned-journey sweep |
| `db:prune` | retention/log pruning |
| `ops:status` | operational counts |

### Looking at the database

```bash
npm run db:view       # http://localhost:5959/ — read-only browser for every table
```

A small standalone dev tool, started separately from the app and never a runtime dependency.

---

## Testing

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # eslint
npm test              # jest — unit + e2e specs
```

**No test reaches the network.** `NODE_ENV=test` turns EMR sessions and verification off, so every
EMR gateway is Null-bound under the suite.

---

## Security notes

- **Never commit `.env`** or `config/channel.generated.ts`; both are gitignored.
- **Set `SESSION_SECRET`** to a real value outside local development. The built-in fallback is a
  placeholder.
- **Never enable `WIRE_LOG` on a real deployment.** It writes card data, bearer tokens and personal
  details to `storage/logs/` verbatim.
- **Resume links are permanent.** `?amd_session=<uuid>` restores a visitor's intake answers (health
  information) and does not expire. Treat `storage/logs/` and `abandonment:signals` output with the
  same care as the links themselves.
- **Identity verification ships disabled.** Do not turn it on without first confirming against the
  provider that a known-good identity comes back valid.
- The shipped legal pages (`/terms/`, `/privacy/`, `/telehealth-consent/`) are placeholders. Replace
  the wording before going live.

See [`docs/OPERATIONS.md`](docs/OPERATIONS.md) for the operator runbook.

---

## Project layout

```
config/          per-deployment behaviour config, one .ts file per concern
prisma/          schema.prisma and migrations
src/             application code: core/, domain/, emr/, payment/, funnel/, journey/,
                 middleware/, routes/, console/, support/
views/           EJS templates (pages/ and partials/)
public/          static files and built assets
build/           asset pipeline and dev tools (Tailwind build, watcher, db viewer)
storage/         gitignored: cache, logs, sessions, SQLite file
test/            Jest unit and e2e specs
docs/            architecture, operations, middleware, journey notes
```

## Documentation

| | |
|---|---|
| [`MERN.md`](MERN.md) | target architecture and the reasoning behind every stack decision |
| [`STATUS.md`](STATUS.md) | build progress, what is real vs. Null-backed, known gaps |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | how the funnel, journey store, catalog and gateways fit together |
| [`docs/MIDDLEWARE.md`](docs/MIDDLEWARE.md) | the nine-slot middleware pipeline, slot by slot |
| [`docs/JOURNEY.md`](docs/JOURNEY.md) | one customer journey traced end to end |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | runbook: scheduled jobs and what each report means |
| [`docs/INTEGRATION-NOTES.md`](docs/INTEGRATION-NOTES.md) | what the EMR and payment provider actually do, as measured |
| [`docs/SPEC-REFERENCE.md`](docs/SPEC-REFERENCE.md) | resolves the `[n.n]` rule citations found in the source |

## Version

**1.0.0** — first release. `package.json` and the release tag should always agree.
