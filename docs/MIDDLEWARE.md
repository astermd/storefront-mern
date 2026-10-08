# The pinned middleware pipeline

Every single request this app answers — a home page GET, a checkout POST, a 404 — runs through the
same fixed chain of 10 steps before a controller ever sees it (9 "pinned" Nest middlewares, plus
`cookie-parser` ahead of all of them). This is not incidental request setup; it is where most of
this port's actual business rules live: session identity, CSRF, the funnel/step-guard logic, and
the durable-state write-back. `src/app.module.ts`'s `configure()` is the *only* place that wires
this order, and the order is load-bearing — several of these middlewares only work correctly
because of exactly what sits inside/outside them.

Source of truth for everything below: `src/app.module.ts` (registration + ordering) and
`src/middleware/*.middleware.ts` (each slot's own implementation). This file explains *why* each
one exists and *why it sits where it sits*, plus every real bug this port found while building it
— several of them only became visible once real (non-Null) EMR/payment integrations existed to
actually exercise the failure path.

## Why middleware, not guards/interceptors

Nest's idiomatic answer to "run something before/after every route" is usually a `CanActivate`
guard or an interceptor. This app deliberately uses **plain Nest middleware** for all 9 pinned
slots instead, for one specific, load-bearing reason: **a Nest guard always runs in a fixed
position *after* all middleware has run.** If `StepGuardMiddleware` (funnel/precondition
enforcement) were a guard instead, a guard-triggered redirect would happen *outside* everything
this pipeline does — including `JourneySaveBackMiddleware`'s write-back of whatever the visitor's
answers/cart/attribution were on this exact request. A visitor who gets bounced by a funnel
precondition would have that whole request's state silently never persisted. Keeping the guard
logic as middleware, nested *inside* `JourneySaveBackMiddleware`, is what makes "the flush always
runs, even on a mid-pipeline redirect" true regardless of which slot decided to redirect.

## The full order, slot by slot

```
Browser
  │
  ▼
cookie-parser()              ← plain Express middleware, not a Nest class; must run first
  │
  ▼
1. CanonicalUrlMiddleware     ← outermost pinned slot
  │
  ▼
2. SeoMiddleware
  │
  ▼
3. SessionMiddleware
  │
  ▼
4. RetiredSessionMiddleware
  │
  ▼
5. AttributionMiddleware
  │
  ▼
6. CsrfMiddleware
  │
  ▼
7. JourneySaveBackMiddleware  ← wraps 8 and 9; flushes durable state on the way OUT
  │    ┌─────────────────────────────────────┐
  ▼    │                                     │
  8. StepGuardMiddleware                     │
  │                                          │
  ▼                                          │
  9. TemplateGlobalsMiddleware                │
  │                                          │
  ▼                                          │
Nest's own guard → interceptor → pipe → Controller
  │                                          │
  └──────────────────────────────────────────┘
                    │
                    ▼
             (response leaves — slot 7's flush has already
              completed by this point, see its own section)
```

Registered via one call in `AppModule#configure()`:

```ts
consumer
  .apply(
    cookieParser(),
    CanonicalUrlMiddleware,
    SeoMiddleware,
    SessionMiddleware,
    RetiredSessionMiddleware,
    AttributionMiddleware,
    CsrfMiddleware,
    JourneySaveBackMiddleware,
    StepGuardMiddleware,
    TemplateGlobalsMiddleware,
  )
  .forRoutes('/');
```

`NODE_ENV=test` makes every one of these append its own name to an `X-MW-Trace` response header
(`src/middleware/trace.ts`) — the mechanism `test/middleware-ordering.e2e-spec.ts` uses to prove,
on every test run, that this exact order actually happens end to end, not just that the code
*looks* ordered correctly.

---

## 0. `cookie-parser()` — not pinned, but first

**What it does:** populates `req.cookies` from the raw `Cookie` header. Nothing downstream can read
a cookie without this — no Nest class does this on its own.

**Why it's first:** `SessionResolver` (used by slot 5, `AttributionMiddleware`) reads
`request.cookies[options.cookieName]` to decide whether a visitor already has a session. If this
middleware isn't registered, `req.cookies` is `undefined` and that read always fails.

**A real, previously-invisible bug this exact gap caused:** `cookie-parser` was missing entirely
for most of this port's life, and it was completely unobservable — because `SESSION_GATEWAY` was
Null-bound the whole time, `create()` always returned `null`, so no `amd_session` cookie was ever
actually issued, and there was never a real cookie for the "cookie present → trust it" branch to
fail to recognize. The instant `EmrSessionGateway` started minting real session ids (a real
`@astermd-hq/sdk` call), the bug became observable immediately: **every single request re-minted a
brand-new EMR session**, discovered via a real multi-request `curl` session showing the
`amd_session` cookie value changing on every request despite the browser sending it back correctly
each time. Fixed by adding `cookieParser()` as the literal first entry in the `.apply()` chain.

---

## 1. `CanonicalUrlMiddleware` — slot 1 of 9, outermost

**Business logic:** one-hop 301 redirect to a canonical URL form — trailing slash, lowercase path,
collapsed double-slashes (spec §23). Only for safe methods (`GET`/`HEAD` — redirecting a `POST`
would silently drop its body) and never for a file-like final segment (`sitemap.xml`,
`robots.txt`, `favicon.ico` — those are conventionally served *without* a trailing slash).

**Why outermost:** every other slot's decision should be made against the *canonical* path, not
whatever spelling the visitor actually typed. `SeoMiddleware` (slot 2) explicitly re-derives the
canonical path itself rather than trusting `req.path`, specifically because this middleware might
have chosen not to redirect (a non-GET request, or a file-like path) — see its own code.

**Query string handling:** preserved byte-for-byte on redirect, not re-encoded — attribution
params (`?utm_source=...`) and resume-link tokens ride in the query string and must survive the
redirect unchanged.

---

## 2. `SeoMiddleware` — slot 2 of 9

**Business logic:** publishes the request's SEO context (`res.locals.seo`) — canonical URL, the
robots directive, site name/default title/description — and enforces the `X-Robots-Tag` response
header from the same value the page's `<meta name="robots">` tag will render. Spec §24.2 requires
the indexing decision enforced *twice*, header and meta tag, from one source of truth; this
middleware is the header half and also the value the meta half reads.

**Why here, not deeper:** it needs the canonicalised path (hence: inside `CanonicalUrlMiddleware`),
but *every* response — including one no controller ever rendered, like a guard-redirect from
`StepGuardMiddleware` deep inside this pipeline — should still carry the header. That rules out
sitting inside any slot that might short-circuit the request itself.

**How the header actually gets set — a real "there's no such moment in Express" problem:** the PHP
original applies this header *after* the handler returns, checking whether a header was already
set. Express has no equivalent "response built, not yet sent" hook to copy that pattern onto. This
middleware solves it by monkey-patching `res.writeHead` — the one call every response path (a
normal render, a redirect, an error page) funnels through immediately before bytes go out — so the
header check happens at the true last possible moment, regardless of which code path produced the
response.

---

## 3. `SessionMiddleware` — slot 3 of 9

**Business logic:** wraps `express-session` (Node's rough equivalent of PHP's native
`$_SESSION`), configured for a long telehealth checkout journey (30-day cookie, `httpOnly`,
`sameSite: lax`, `secure: 'auto'` — trusts `X-Forwarded-Proto`, matching the nginx/apache configs
this app is deployed behind).

**A deliberate, documented scope limit:** `MemoryStore` (express-session's own default) is used
on purpose, not a placeholder for "add Redis later." Nothing durable is ever meant to live in this
session — only a CSRF token, and whatever `AttributionMiddleware` reads straight off the request's
own cookie. All real, durable journey state (cart, answers, buyer details, everything
`JourneySaveBackMiddleware` flushes) lives in the `sessions.journey_state` database column, not
here — so a process restart losing this in-memory store loses nothing that matters.

---

## 4. `RetiredSessionMiddleware` — slot 4 of 9

**Business logic:** clears the analytics-session cookie once a journey has genuinely completed
(`state.sessionRetired === true`), on the first request that *isn't* the receipt page itself — so
a visitor who places an order and keeps browsing doesn't keep dragging a "finished" session
around, but the receipt page itself can still read it one last time.

**Why its position is load-bearing — a real header-ordering race:** the cookie this clears is
*issued* by `AttributionMiddleware` (slot 5, **inside** this one). Browsers apply `Set-Cookie`
headers in the order they arrive, so if this clear were registered *before* the issuing middleware,
the re-issued cookie would simply overwrite the clear and the session would never actually retire.
Sitting outside slot 5 means this middleware's `res.writeHead` patch (registered before `next()`)
still runs *after* slot 5's synchronous `Set-Cookie` append, so the clear lands later in the header
list and correctly wins.

**Why `res.writeHead`, not `res.on('finish')`:** identical reasoning to `SeoMiddleware` above —
this needs to mutate a *header*, and `finish` fires only after headers are already sent, too late.

**Fails open everywhere:** an unreachable journey store or an unresolvable path both just leave the
cookie alone rather than guessing.

---

## 5. `AttributionMiddleware` — slot 5 of 9

**Business logic:** the actual session-identity resolution step. Reads the request's cookie
(`SessionResolver`), decides whether this visitor already has a session or a new one should be
minted, and publishes the result as `req.sessionUuid` for everything downstream. Also captures
first-touch attribution (referrer, `utm_*` params).

**The "may this request mint a new session" gate (`mayCreate()`) — a real, live-relevant safety
check:** a session is only minted for a plain `GET`, on a path that isn't an excluded machine
endpoint, **and that names a real, registered route** (`RouteExistsChecker`, which introspects
Express's own router). This check used to be inert under the Null-only EMR era (`create()` always
returned `null` regardless), so it didn't matter whether it ran correctly. It matters for real now
that `EmrSessionGateway` actually calls `@astermd-hq/sdk`: without this gate, a bot scanning random
paths, or a stray asset request to a URL nothing serves, would mint a **real, billable EMR
session** before `NotFoundController` ever got a say.

**Why it doesn't need `res.writeHead`/`res.on('finish')` machinery at all:** unlike slots 4 and 7,
everything this middleware decides (the session uuid, whether to issue a cookie) is fully known
*before* `next()` is called — so the `Set-Cookie` header is appended synchronously, immediately,
ahead of calling `next()`. This is also precisely what makes slot 4's *later* (send-time) clear
correctly win the ordering race described above.

**Error boundary for the whole of session resolution:** an unreachable database or a failed real
EMR call is caught here, in one auditable place (`session.resolve_failed`), rather than swallowed
piecemeal inside the repository/gateway layer — a tracking failure must never break the page.

---

## 6. `CsrfMiddleware` — slot 6 of 9

**Business logic:** mints (or reuses) a per-session CSRF token on **every** request, not only
mutating ones — so the token is already sitting in the session by the time any page with a form
renders. Rejects `POST`/`PUT`/`PATCH`/`DELETE` requests whose submitted token doesn't match, with a
`419` and a plain-text message telling the visitor to refresh.

**Why inside `SessionMiddleware` (slot 3):** it reads/writes `req.session._csrf`, which only
exists once `express-session` has run.

**Accepts the token from two places:** the request body (`_csrf` field, for a normal HTML form
submit) **or** an `X-CSRF-Token` header. The header path exists specifically because
`fetch()`-driven requests carrying a `FormData` body are always encoded as `multipart/form-data`
regardless of the source `<form>`'s own `enctype` — this app parses no multipart body on most
routes, so `_csrf` inside that body never reaches `req.body` on the server. A real, previously
completely invisible bug (see `public/js/intake.js`'s history): every fetch-driven `save()`/
`submit()`/early-capture call was silently rejected with `419` in a real browser, because the
`_csrf` field it carried never actually arrived — fixed two-sided, by having the client send the
header this middleware already accepted as a fallback, and by adding a multipart-body interceptor
(`AnyFilesInterceptor()`) on the routes that need the *other* fields out of that same body.

**Timing-safe comparison:** `crypto.timingSafeEqual`, matching PHP's `hash_equals()` — guards
against a timing attack on the token comparison itself.

---

## 7. `JourneySaveBackMiddleware` — slot 7 of 9, wraps 8 and 9

**This is the single most load-bearing middleware in the whole pipeline**, and the entire reason
"pinned middleware, never guards" is a rule at all (see the top of this file). It writes the
journey's durable state (`sessions.journey_state`) back to the database exactly once, after
*everything* downstream — `StepGuardMiddleware`, `TemplateGlobalsMiddleware`, Nest's own
guard→interceptor→pipe→controller stack — is truly finished touching it, **whichever of those
layers ends up deciding the response** (a normal render, a mid-pipeline redirect, a thrown
exception).

### Bug #1 (design-level, caught before ship): `try { await next() } finally { flush() }` does not work

The naive, "obviously correct" Express translation of "run the handler, then clean up" is:

```ts
try { await next(); } finally { flush(); }
```

This is **wrong** for Express-style middleware with an async downstream handler, and it was
verified empirically (a standalone probe, before this middleware was ever written): `next()` is a
plain callback, not a promise tied to when the response is actually finished. `await next()`
resolves as soon as the *synchronous* part of dispatching the next layer returns — typically
*before* an async controller has done any of its actual work. A test middleware wrapping a
controller that does `await sleep(50)` before mutating state ran its `finally` block *before* the
controller's mutation happened, every single time.

### Bug #2 (found live, after real EMR/payment integrations existed): `res.on('finish')` is too late

The first real fix used `res.on('finish', flush)` instead — correct for *whether* the flush runs
(fires after a normal async controller, a redirect issued without ever calling `next()`, or a
thrown exception, all equally), but wrong about *when*: `finish` fires only once the response has
already been sent to the client. This app's own `intake.js` posts `save()`/`submit()` through
`fetch()`, which **automatically follows** the very 303 redirect this middleware's own request
answers with — a second, fully independent HTTP request. On localhost that follow-up request's
round trip is fast enough to reach the server and read the session row again *before* the first
request's fire-and-forget flush (only kicked off after the response was already gone) had actually
finished writing it.

**Confirmed live, not theoretical:** the identical save sequence (fill a field, click Next)
persisted a visitor's just-typed answers on most runs and silently dropped them on others, purely
on timing — indistinguishable from real data loss to whoever happened to hit the slow run.

**The actual fix:** hold the response open until the flush resolves, instead of firing it after the
response is already gone. `res.end` — which `res.json()`/`res.redirect()`/`res.render()` **all**
funnel through internally in Express — is wrapped so the real `end()` call only happens after
`ensureFlushed()`'s promise settles:

```ts
const originalEnd = res.end.bind(res);
res.end = ((...args) => {
  void ensureFlushed().finally(() => originalEnd(...args));
  return res;
}) as Response['end'];
```

Nothing downstream that reads the DB can now observe this request's session row before its own
write has landed. `finish` fires strictly after `end()` completes, so this delays it too — by one
local DB write, imperceptible to a visitor. Every existing guarantee about *whether* the flush runs
is completely unchanged; only *when* it runs relative to the response moved earlier.
`res.on('close')` is kept as a fallback for a connection the visitor aborted before any response
body was ever sent — the only path that would otherwise never flush at all.

### A related, deeper bug this fix alone didn't close: cross-request lost updates

Holding one request's own response open fixes the race *within that one request's own
redirect-then-follow-up chain*. It does **not** protect against two genuinely different,
independent requests for the *same session* racing each other — e.g. a slow intake save (a real
EMR call in the middle of `IntakeSession.save()`) still in flight when a **separate** checkout page
visit, for the same session, reads the row and later flushes its own (older) snapshot back over
the top.

**Confirmed live:** exactly this happened — a checkout page load's own flush silently overwrote
answers an intake save had *already* correctly persisted, because the checkout request's flush was
built from a snapshot read before the intake save's write landed.

Fixed with real optimistic concurrency in `JourneyStore.flush()` / `SessionRepository.save()`
(**not** in this middleware — the middleware only calls `journey.flush()`; the concurrency control
lives one layer down):

- The write is guarded on the row's `updated_at` as it stood when this journey was **loaded**, via
  a conditional `UPDATE ... WHERE session_uuid = ? AND updated_at = ?` (`updateMany`, checked for
  `count > 0`).
- On a conflict (zero rows matched, row still exists), `flush()` re-reads the current row and
  retries **once**, replaying onto that fresh copy only the top-level fields *this* request's own
  snapshot actually changed (diffed against what it looked like at load time) — never a
  whole-object overwrite on retry, which would just move the exact same race one step later
  instead of closing it.
- `not_found` (the row is genuinely gone) still throws `JourneyWriteFailed`, caught and logged by
  this middleware exactly as before — that part of the contract never changed.

This doesn't make a slow write instantaneous — a real EMR call is still exactly as slow as it is —
but it does mean a *later* read (a real visitor's natural pace, not a rapid scripted click-through)
reliably sees the correct, fully-merged state, never a permanently lost write.

**Idempotent flush, by construction:** `res.on('close')` can fire after `res.end`'s patched flush
already ran, or (for a genuinely aborted connection) with `end` never called at all — a single
memoized `flushPromise` makes calling `ensureFlushed()` more than once always a no-op after the
first real attempt.

---

## 8. `StepGuardMiddleware` — slot 8 of 9

**Business logic:** enforces every funnel step's preconditions in one single place, rather than
scattering a guard check into every page/controller (spec §22.11). Matches the current request's
**path** (not a route name/argument, since this runs *before* Nest's own routing has matched
anything yet) against `FlowDefinition`'s step table, looks up that step's required preconditions
(`cart_not_empty`, `intake_satisfied`, `not_disqualified`, etc. — `StepPreconditions`), and 302s
away from any step whose requirements aren't met.

**The redirect target is a routing decision, not "the first unmet requirement":** with an empty
cart, *every* funnel step is unsatisfied — naively redirecting to "the first step whose requirement
is unmet" would bounce a visitor in circles forever. The actual target comes from `StepRouter`,
which computes where a cart/journey in this exact state should actually go next.

**Self-redirect fail-closed:** if the routing decision names the very step the visitor is already
on, that can't be followed (it would loop) and must not be silently ignored either (that would
serve a page whose precondition is genuinely unmet). This case fails closed to the flow's entry
step and logs `funnel.guard_self_redirect` — the flow definition and the routing decision
disagreeing is treated as a real defect worth an operator's attention, never swallowed silently.

**Why this must be middleware, never a `CanActivate` guard:** identical reasoning to the top of
this file — a guard-based redirect here would run in Nest's fixed post-middleware guard slot,
which sits *outside* `JourneySaveBackMiddleware` (slot 7, wrapping this one). The whole point of
this middleware existing inside slot 7 rather than as a guard is so a guard-redirected visitor's
journey state still gets flushed.

**A real bug this exact middleware surfaced (the most serious one this port has found so far — see
the plan's "Corrections found during implementation" section for the full account):**
`MiddlewareConsumer.forRoutes('*')` (the seemingly-obvious "match every route" spelling) silently
corrupted every pinned middleware's view of the request path, since **Phase 1** — invisible the
entire time until a middleware's *decision*, not just its bookkeeping, depended on `req.path` in a
way that changed the actual response, which only started happening once this middleware became
real. Express treats any non-root path handed to `.use()` as a mount prefix and relativizes
`req.url` for the duration of that middleware; for a wildcard pattern, the "matched prefix" is the
*entire* request path, so `GET /checkout/` arrived at this middleware as `req.path === '/'` while
`req.originalUrl` correctly still said `/checkout/` — meaning this middleware evaluated the
**wrong step's** requirements entirely. The fix is `forRoutes('/')`, not `'*'`/`'*splat'` — Nest
special-cases a route pattern matching exactly `/^\/?$/` to skip the path argument and call
`app.use(fn)` with no path at all, which Express does not relativize. **Any future middleware
registration in this app must use `forRoutes('/')` for "every route," never a wildcard string.**

---

## 9. `TemplateGlobalsMiddleware` — slot 9 of 9, innermost

**Business logic:** publishes every request-scoped/config-derived value a template might need as a
local, before the route handler runs at all — site name/url, the CSRF token, the Google Maps API
key, the footer's "Treatments" column, the current canonical path, and the entire mini-cart drawer
view-model (count, subtotal, line items, and which of "Continue Assessment" /
"Proceed to Checkout" / a terminal-step action the drawer should offer).

**Why the cart is assembled here, not per-controller:** the mini-cart drawer partial is included by
a layout no single controller owns — assembling it once, centrally, is the only way every page
that includes that partial sees a consistent cart.

**A subtle, deliberately-documented staleness window:** because this runs *before* the route
handler, the cart it publishes describes the cart on the way **in** to a mutating request (e.g.
`POST /cart/add/`), not the cart that mutation just produced on the way out. This is safe *only*
because every cart-mutating controller always answers with a `303` redirect rather than rendering
anything itself — the response that would show a stale drawer is never actually rendered; the GET
that follows the redirect re-runs this whole middleware chain and rebuilds the globals from the
cart the handler actually saved.

**`cartActions()`'s three shapes**, resolved once per request rather than guessed per template:
1. A questionnaire still outstanding → both "Continue/Start Assessment" and (if applicable)
   checkout, assessment first.
2. A step in `TERMINAL_LABELS` (`not_eligible`, `verify`, `receipt`) owed → that one action alone,
   replacing both of the others.
3. Anything else with a payable cart → checkout alone.
4. The router says `home` → nothing at all (the drawer already appears on every page; a link back
   to the page behind it is noise).

**Fails open, everywhere, individually:** an unavailable cart store, an unavailable journey state,
or a funnel step with no configured path each degrade to an empty/partial result and a warning log
line — never a broken page.

---

## Cross-cutting notes

- **Every slot calls `addTrace(res, '<name>')` first**, a no-op outside `NODE_ENV=test`
  (`src/middleware/trace.ts`) — the mechanism that makes this exact document's ordering claims
  independently checkable by a test, not just by reading the source.
- **Two different "run something at send-time" patterns exist on purpose, for two different
  needs**: `res.writeHead` patching (`SeoMiddleware`, `RetiredSessionMiddleware`) for anything that
  must still *mutate a header* based on what happened downstream — `finish` is too late for that,
  headers are already gone. `res.end` patching (`JourneySaveBackMiddleware` only) for the one case
  that needs to **delay the response itself**, not just append to it. Never `res.on('finish')`
  alone when timing against a fast follow-up request matters — see slot 7's history above for
  exactly what goes wrong.
- **`@nestjs/testing`'s `overrideProvider` does not affect `MiddlewareConsumer.apply()`.**
  Overriding a middleware class's provider changes what `moduleRef.get()` returns, but the actual
  HTTP pipeline still invokes the *original* class — testing a scenario where a pinned slot must
  behave differently requires composing a minimal standalone test module with the real middleware
  class registered normally, not an override.
