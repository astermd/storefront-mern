# One real customer journey, traced end to end

This document walks through **one complete, real visit** to this storefront — from the very first
page load to a genuinely placed order — and explains, at every step, exactly which file and which
function handled it, what business rule it's enforcing, and which of those steps actually reach a
real external system (AsterMD's EMR, and the CheckoutChamp payment processor) rather than just
local code.

It was written *from* a real, live run of this exact journey (using Playwright to drive a real
Chrome browser against the real dev-sandbox AsterMD account), not from reading the code in the
abstract — every "here's what happens" claim below was watched actually happening, and several of
the details called out here (the real API call, the real database row, the real log line) are
quoted directly from that run.

If you are new to this codebase, read this top to bottom once. It is the single fastest way to
understand how the pieces actually fit together — the home page, the middleware pipeline
(`docs/MIDDLEWARE.md`), the catalog, the intake/forms engine, the funnel router, and checkout — all
in the order a real visitor actually encounters them, rather than as separate, disconnected
subsystems.

**Every single request in every step below first passes through the 9-slot middleware pipeline**
documented in `docs/MIDDLEWARE.md` (session resolution, CSRF, the funnel step guard, the durable
state flush, etc.). That document is not repeated here — this one picks up *after* the pipeline,
at the route handler, and only calls the pipeline out again where a specific step depends on
something a specific middleware slot decided.

---

## The whole journey, at a glance

```
GET  /                          Home page
GET  /treatments/                Product listing
GET  /products/{slug}/           Product detail
POST /cart/add/                  Add to cart (+ funnel routing decision)  ──▶ redirects to:
GET  /intake/medical/            Intake form opens (fetch + cache the questionnaire)
POST /intake/save/  (× N)        One request per "Next" click — save + validate one page
POST /intake/submit/             Final submit — validates every page, completes the intake
GET  /checkout/                  Checkout page (prefill, plan, card fields)
POST /checkout/                  Pay Now — the real charge
GET  /thank-you/                 Receipt
```

Everything below expands each of these into what actually runs.

---

## 1. `GET /` — the home page

**Route:** `src/routes/home/home.controller.ts`

```ts
@Get()
home(@Req() req, @Res() res): void {
  res.render('pages/home', {
    featured_products: this.catalog.listedProducts().slice(0, 6),
    structured_data: this.structuredData.json(req.path),
  });
}
```

**Business logic:** show up to 6 products on the home page. Nothing more happens here — no login,
no cart check, nothing funnel-related. This is the one page every visitor can always reach.

**Where the products come from — and why this is NOT a live API call:**
`this.catalog` is `CatalogProvider` (`src/catalog/catalog-provider.ts`). It reads from a **static,
pre-built TypeScript file**, `config/products.generated.ts` — not from AsterMD's API on every
request. That file is written *once, on demand* by a separate console command (`theme:sync`, see
below), and the running app just reads it as plain data forever after, until someone runs that
command again.

**Why build it this way instead of calling AsterMD live on every page view?** Speed (no network
round-trip per page load) and resilience (AsterMD being briefly unreachable doesn't take the whole
storefront down with it).

**The 4-piece catalog architecture**, all involved in every catalog read, not just this one:

| Piece | File | Job |
|---|---|---|
| `CatalogBuilder` | `src/catalog/catalog-builder.ts` | Pure transform: AsterMD's real, messy, deeply-nested API response → this app's clean `{slug, name, variants: [{id, price_cents, provider: {offer_id, product_id}}]}` shape. No I/O. |
| `products.generated.ts` | `config/products.generated.ts` | The *output* of running `CatalogBuilder` against a real API call — written by `theme:sync`, overwritten wholesale on the next sync. |
| `products.overrides.ts` | `config/products.overrides.ts` | Hand-written, `theme:sync` never touches it. For anything the sync would otherwise wipe out: a manual price correction, geo-blocking, a product AsterMD doesn't even know about. |
| `CatalogMerger` | `src/catalog/catalog-merger.ts` | Combines the two, matched by `emr_product_id` (never by slug, so renaming a product doesn't orphan its override). |

`CatalogProvider`'s constructor runs that merge **once, when the app process starts** — every
request after that just reads the already-merged, in-memory result. (LAMP does the conceptually
identical thing, just re-merging once per PHP request instead of once per process — see
`docs/MIDDLEWARE.md`'s intro for why Node and PHP differ here.)

**Database calls this step makes:** none, beyond whatever the middleware pipeline itself did
(resolving/minting the session row).

---

## 2. `GET /treatments/` — the product listing

**Route:** `src/routes/catalog/product-list.controller.ts`

```ts
@Get()
list(@Req() req, @Res() res): void {
  res.render('pages/treatments', {
    products: this.catalog.listedProducts(),
    categories: this.catalog.categories(),
    structured_data: this.structuredData.json(req.path),
  });
}
```

Same `CatalogProvider`, no new API/DB call. `listedProducts()` filters to `kind === 'rx' || kind
=== 'otc'` only — a lab test or a free add-on never appears here directly, only as an attachment
riding along with a real product.

**`categories()`** (`src/catalog/catalog-provider.ts`) is worth reading in full, because it
explains a real, slightly odd thing you'll see on this page:

```ts
categories(): string[] {
  const names = new Set<string>();
  for (const product of this.listedProducts()) {
    for (const category of product.categories ?? []) {
      names.add(category);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}
```

It just collects every listed product's raw `categories[]` strings and dedupes them — **there is
no display-name mapping anywhere.** Whatever string AsterMD tagged a product with becomes a filter
checkbox label verbatim. This is why Rameltion's real category shows up as a checkbox literally
labeled `"ssd"` — that's real AsterMD data (an internal category code), not a bug and not a
placeholder in this codebase.

---

## 3. `GET /products/{slug}/` — the product detail page

**Route:** `src/routes/catalog/product-detail.controller.ts`

```ts
@Get(':slug')
detail(@Param('slug') slug, @Req() req, @Res() res): void {
  const product = this.catalog.product(slug ?? '');
  if (product === null) throw new NotFoundException();
  res.render('pages/product', { product, structured_data: this.structuredData.json(req.path) });
}
```

`catalog.product(slug)` is a plain object lookup (`this.merged[slug]`) into the same in-memory
catalog from Step 1 — still zero DB reads, zero live API calls.

Everything the page needs is already sitting inside that one `product` object: its `variants`
(e.g. Rameltion's "8mg" dosage, and that variant's `provider.offer_id`/`provider.product_id` — the
payment-processor mapping that becomes very important in Step 11), `price_cents`, and — critically
for what happens next — **`teleform_id`**: which AsterMD questionnaire this product requires before
it can be ordered. Rameltion's is `69d626def20ad2d9d313eecc`.

---

## 4. `POST /cart/add/` — add to cart, and the funnel routing decision

**Route:** `src/routes/cart/cart.controller.ts`

```ts
@Post('add')
async add(@Body() body, @Req() req, @Res() res): Promise<void> {
  const cart = store.currentCart();
  const outcome = this.rules.add(cart, body.slug, body.variant_id, quantity);   // 1
  if (!outcome.accepted) { res.redirect(303, safePath(body.return_to)); return; }

  store.save(cart);
  await this.mirror.mirror(sessionUuid, cart, state);                          // 2 — real EMR call

  const step = body.intent === 'checkout' ? 'checkout' : this.router.nextStep(cart, state);  // 3
  res.redirect(303, this.flow.pathFor(step));
}
```

Three real things happen here, in order:

**1. Pure domain logic, no I/O.** `CartRules.add()` (`src/domain/cart-rules.ts`) validates the
slug/variant exist, enforces max-quantity, and auto-attaches any bundled lab test the product
declares. The resulting cart is written into the journey's in-memory state (flushed to the
`sessions` table by the middleware pipeline's slot 7 at the end of the request — see
`docs/MIDDLEWARE.md`).

**2. Mirror the cart to the real EMR.** `CartMirror.mirror()` (`src/emr/cart-mirror.ts`) calls the
real, bound `CartGateway` (`EmrCartGateway` in this build) — `client.carts().create()` on the
journey's first mutation, `client.carts().update()` on every one after. This is a genuine AsterMD
API call, separate from anything checkout-related — it's what makes the cart visible on AsterMD's
own side at all.

**3. The funnel routing decision — the single most important function in this whole journey.**
`FunnelRouter.nextStep()` (`src/domain/funnel-router.ts`):

```ts
nextStep(cart, state) {
  if (state?.isDisqualified()) return 'not_eligible';
  if (cart.isEmpty()) return state?.placedOrders.length > 0 ? 'receipt' : 'home';
  if (!FunnelRules.everyRxLineHasAPlan(cart)) return 'home';
  if (this.rules.outstandingPrequalificationForm(cart, state) !== null) return 'prequalification';
  if (this.rules.outstandingIntakeForm(cart, state) !== null) return 'intake.medical';   // ← this fired
  if (this.placement.outstandingFor(state)) return 'verify';
  return 'checkout';
}
```

For Rameltion (a teleform, no separate prequalification form, not yet completed), this returns
`intake.medical` — hence the `303` redirect to `/intake/medical/`. This exact function is asked
again by two other places later in the journey (`StepGuardMiddleware`, to block a visitor from
skipping ahead; the checkout/intake controllers themselves, to know which questionnaire a step
means) — all three are guaranteed to agree, because they all call the same function.

**Why every response here is a `303`, never a `200`:** so `TemplateGlobalsMiddleware` (pipeline
slot 9) — which builds the mini-cart drawer *before* the route handler runs — never renders a page
describing the cart *before* this mutation. The browser's follow-up `GET` (auto-followed by the
redirect) is what actually shows the post-mutation state. See `docs/MIDDLEWARE.md`'s slot 9 section.

---

## 5. `GET /intake/medical/` — the questionnaire opens

**Route:** `src/routes/intake/intake.controller.ts` → `IntakeSession.open()` (`src/forms/intake-session.ts`)

```ts
async open(teleformId, step) {
  const definition = await this.definition(teleformId);   // the full form: every page, every field
  const metadata = await this.metadata(teleformId);        // small: {identifier, dbFields, ...}
  ...
  if (state !== null && !state.hasEmrEvent('intake_initiated')) {
    await this.submissions.record(sessionUuid, 'intake_initiated', teleformId, ...);
    state.recordEmrEvent('intake_initiated');
  }
  return new IntakeView(...);
}
```

**Two real things happen here:**

**1. Fetching the questionnaire — a real, two-hop, disk-cached lookup**
(`src/forms/teleform-source.ts`, `TeleformSource`):

```
metadataFor(teleformId)
  → gateway.metadata(teleformId)        // real AsterMD API call, on EVERY request — small, cheap
  → returns {identifier, dbFields, ...} // the identifier IS the cache key: it encodes the form's
                                         // own version/publish time

definitionFor(teleformId)
  → this.cache.get(metadata.identifier) // disk cache at storage/cache/forms/
  → HIT?  return it — zero network calls for the actual questions
  → MISS? gateway.definition(metadata)  // real API call, then cached to disk for next time
```

This is a genuinely clever design: **there is no manual cache-invalidation step anywhere.** If
AsterMD republishes this questionnaire with a change, the new version simply gets a *different*
`identifier`, so the old cached file is never looked up again — it doesn't need to be deleted, it
just becomes silently unreachable. (Metadata itself is small enough that it's just fetched live on
every request rather than cached — see the real log evidence at the end of this document: a
`form_definition`/`metadata` call appears before almost every single save/submit.)

**2. Firing the "questionnaire started" event to AsterMD — exactly once per journey.**
`state.hasEmrEvent('intake_initiated')` is the guard: a visitor who closes the tab and comes back
to the same half-finished form does **not** re-fire this and does **not** produce a second lead
record.

**Then rendering:** every field on every page goes through `FieldViewModel.for()`
(`src/forms/field-view-model.ts`), which dispatches on the field's own declared `template` key
— **never** on its raw `type` — specifically so the type-to-partial mapping lives in exactly one
place. (This dispatcher is also where two real, previously-invisible bugs were found and fixed
earlier in this port's life: a wrong `data-*` attribute name that made every authored Continue
button completely inert, and a "two-button" field pattern that silently dropped its second button
— both are history now, but they lived exactly here.)

**Important architectural point:** the *entire* form — all 5 pages, all 44 fields for Rameltion's
teleform — is rendered into **one single HTML response**, right here. Clicking "Next" later does
**not** fetch new page content from the server.

---

## 6. `POST /intake/save/` — one request per "Next" click

This fires once per page, every time you click Next. It does **not** advance you to the next page
by itself — advancing is a client-side-only DOM change (see the aside below). What it *does* do is
save and validate the page you're leaving.

**Client side** (`public/js/intake.js`):
```js
save(currentPageIndex).then(() => goToPage(currentPageIndex + 1));
```
Sends the whole `<form>` as `FormData`. Browsers always encode `FormData` as
`multipart/form-data`, regardless of the form's own `enctype` — worth knowing, because it's exactly
why this route needs `@UseInterceptors(AnyFilesInterceptor())` (from `@nestjs/platform-express`) on
the server side to actually parse the body at all, and why the CSRF token is sent as **both** a
form field and an `X-CSRF-Token` header (a real bug this port found: without the header, this exact
request used to fail with `419` on every real browser submit, because the multipart body was never
parsed and the token inside it never reached `req.body`).

**Server side, `IntakeSession.save()`** (`src/forms/intake-session.ts`), in exact order:

```ts
async save(teleformId, step, posted, pageIndex) {
  const answers = await this.store(teleformId, definition, posted);   // 1
  const outcome = this.disqualification.evaluate(teleformId, definition, answers);  // 2
  if (outcome.isHard()) return this.stop(teleformId, outcome);         // → redirects to /not-eligible/
  const errors = this.validator.validate(definition, answers, pageIndex);  // 3 — THIS page only
  if (Object.keys(errors).length > 0) return IntakeResult.invalid(errors);
  await this.report(teleformId, definition, answers, 'intake_in_progress', ...);  // 4
  return IntakeResult.saved();
}
```

1. **`store()`** merges this page's posted values into the full stored `AnswerSet`, filtered
   against what the form actually declares (`definition.field(name) === null` → silently dropped —
   a name the form doesn't know about is never trusted), then calls `.withDerived(definition)` —
   this is where any computed value (like a BMI composite from height+weight, once those pages are
   reached) gets calculated **server-side**, never trusted from the client even if the browser also
   shows a live preview of it.
2. **`disqualification.evaluate()`** checks the *complete, up-to-date* answer set against every
   **hard** termination rule the form itself declares (rules configured in `config/intake.ts` are
   only a fallback, for a form that declares none of its own). A match redirects straight to
   `/not-eligible/`.
3. **`validator.validate(..., pageIndex)`** — required-field/format validation for *only the page
   just posted*. (Final `submit()`, below, validates every page at once instead of just one — that
   difference is the whole reason a "back to page 1 with no explanation" bug this port found was
   actually happening: the server's own re-rendered response, carrying the real per-field error and
   which page it belonged to, was being discarded by a client-side `window.location.reload()` and
   replaced with a blind reset to page 0. Fixed by having the server tell the client which page to
   reopen on, and having the client actually use the POST's own response instead of reloading.)
4. **`report()`** — a private helper, shared by both `save()` and `submit()`:

```ts
private async report(teleformId, definition, answers, event, progress) {
  await this.submissions.record(session, event, teleformId, ...);              // a progress event
  await this.leads.capture(session, state, this.mapper.build(metadata, answers, definition));  // the lead
}
```

**This is the important part for the next section: `leads.capture()` runs on *every* save, not
just the final submit.** What it actually *does*, though, is threshold-gated — see Step 7.

### Aside: what "fetching live" actually means, page by page

A question worth answering explicitly, because it's not obvious from the outside: does navigating
between pages re-fetch anything from AsterMD?

| | Fetched from AsterMD | How often |
|---|---|---|
| The questionnaire's **metadata** (small) | Yes, live | On every single server round-trip (every save, every submit) — cheap, not disk-cached |
| The questionnaire's **full definition** (all pages/fields — the big one) | Yes, live, but only on a cache miss | Once per form-version; every request after reads it straight from `storage/cache/forms/` |
| **Moving between pages** (clicking Next when nothing needs saving) | No | Purely a client-side DOM toggle (`goToPage()` in `public/js/intake.js` — shows/hides sections already sitting in the one page loaded in Step 5) |

---

## 7. Filling name + email — the real lead/opportunity gets created

`LeadWriter.capture()` (`src/forms/lead-writer.ts`) — called by `report()` above, on **every**
save, but only actually reaches AsterMD once a real threshold is crossed:

```ts
async capture(sessionUuid, state, payload) {
  if (state.opportunityId !== null) {
    return this.gateway.update(existing, payload);     // real EMR update — from here on, every time
  }
  if (!this.mapper.ready(payload)) {
    return LeadOutcome.noneCreated();                  // silently does nothing — not enough known yet
  }
  const opportunityId = await this.gateway.create(...); // the ONE real create call, ever, per journey
  state.opportunityId = opportunityId;                   // remembered for the rest of the journey
}
```

`RecordMapper.ready(payload)` (`src/forms/record-mapper.ts`) is **first name AND email both
present** — nothing less. Concretely, in a real run:

- **Pages with only symptom checkboxes** → `report()` still runs, but the payload has no name/email
  → `ready()` is false → the real API is never called, silently.
- **The page with name + email** → the moment both are filled and you click Next → `ready()`
  becomes true for the very first time → **this exact click fires the real, one-time
  `client.opportunities().create()` call** (or whatever the SDK's real create endpoint is) —
  confirmed live, with a real timestamp:

```
external.emr.opportunity_write {operation: create, outcome: created, latency_ms: 297.2}
```

- **Every page after that** → `state.opportunityId` is no longer null → every subsequent save is an
  `update()`, layering in newly-answered fields (activity level, BMI, allergies, symptoms, health
  history — everything) onto that same one record.

**A real, live-observed detail worth knowing:** this create call is a genuine network round-trip
to AsterMD, and it can take a few real seconds. This port disables the Next/Submit button while a
save is in flight (`aria-busy`, `public/js/intake.js`) specifically so a visitor double-clicking
during that window can't fire a second, racing save — confirmed live: the button stayed correctly
disabled for several seconds while this exact create call was in flight.

**Why the *same* opportunity id shows up across separate, unrelated-looking sessions:** if two
different browser sessions submit the same email address, AsterMD correctly recognizes it as the
same patient and returns the existing opportunity id rather than creating a duplicate — that's
correct EMR behavior, not a bug, and not something this codebase controls.

---

## 8. Later pages — BMI, disqualification, and the "why this page has 6 red asterisks" question

Filling activity level / height / weight / allergies / conditions / symptoms and clicking Next runs
through the exact same `save()` → `store()` → `disqualification.evaluate()` → `validator.validate()`
→ `report()` sequence as Step 6, with two things worth calling out specifically because they were
real questions/bugs found while building this port:

**BMI is computed server-side, from real height/weight, every time.** `AnswerSet.withDerived()`
(inside `store()`) calculates it — never trusted from a client-side JS preview, specifically so a
disqualifying score can't be bypassed by blocking/disabling JavaScript (`RecordMapper`/
`AnswerSet`'s own documented reasoning).

**The red-asterisk required fields on this page are genuinely, correctly required — confirmed
directly against the real AsterMD teleform data**, not a rendering bug:
```
dropdown_15 (activity), number_18 (height), number_19 (weight),
dropdown_24 (allergies), dropdown_26 (conditions), choice_multi_28 (symptoms) — all required: true
```
A **separate, real bug** this port found and fixed here: `field-choice-multi.ejs`'s checkboxes
never carried an HTML `required` attribute at all (unlike a same-named radio group, where HTML
natively supports "at least one must be checked" — checkboxes have no such native mechanism). The
Next button's own enable/disable logic (`isWrapperAnswered()` in `public/js/intake.js`) had to be
taught to check "at least one checkbox in this required group is checked" directly, rather than
relying on the browser's own (non-existent, for checkboxes) validation.

**A separate, real content gap** worth knowing about, not fixable in this codebase: some of these
required multi-select questions (e.g. "do you take any of these 3 specific medications") have no
"none of the above" option in AsterMD's own authored data — a patient who takes none of the listed
medications has no honest way to answer. That's a gap in the questionnaire's own content, not a
rendering defect.

---

## 9. `POST /intake/submit/` — the final submission

`IntakeSession.submit()` (`src/forms/intake-session.ts`) — the same shape as `save()`, with three
real differences:

```ts
async submit(teleformId, step, posted) {
  const answers = await this.store(teleformId, definition, posted);

  if (definition.unsupportedTypes().length > 0) {                    // 1
    return IntakeResult.invalid({ _form: '...cannot collect here...' });
  }

  const outcome = this.disqualification.evaluate(teleformId, definition, answers);
  if (outcome.isHard()) return this.stop(teleformId, outcome);

  const errors = this.validator.validate(definition, answers, null);  // 2 — EVERY page, not just one
  if (Object.keys(errors).length > 0) return IntakeResult.invalid(errors);

  await this.report(teleformId, definition, answers, 'intake_completed', ...);  // 3

  state.markFormCompleted(teleformId);
  FurthestStep.advance(state, step);
  return IntakeResult.finished();
}
```

1. **Unsupported field-type check** — refuses the whole submission outright if this questionnaire
   declares a field type this renderer genuinely can't draw. The reasoning: a clinician must never
   read an intake that silently dropped a question because the storefront didn't know how to render
   it.
2. **`validator.validate(..., null)`** — passing `null` for the page index validates **every page
   at once**, not just the last one. This is the one real behavioral difference from `save()`.
3. **`report(..., 'intake_completed', ...)`** — the same private helper as every save, but firing
   the `intake_completed` event (distinct from `intake_in_progress`) and one final `LeadWriter`
   update carrying the complete answer set.

Real, confirmed log trail for this exact call:
```
external.emr.form_save         operation: intake_completed, outcome: accepted
external.emr.opportunity_write operation: update, opportunity: 6ab51d...
```

`state.markFormCompleted(teleformId)` is what `FunnelRouter.nextStep()` (Step 4's function) reads
on the *next* request — it now returns `checkout`, since nothing else is outstanding. The browser's
auto-followed redirect lands on `/checkout/`, which immediately fires a `checkout_visited` event —
the very next section.

---

## 10. `GET /checkout/` — the checkout page

**Route:** `src/routes/checkout/checkout.controller.ts` → `CheckoutService.view()`
(`src/checkout/checkout.service.ts`)

Real pieces this assembles:

- **`prefill`** — `Prefill.from(metadata, definition, answers, workingState)`
  (`src/checkout/prefill.ts`). This is where the intake answers you already typed (name, email)
  show up pre-filled here, so you're not asked twice. (A real, previously-broken piece: AsterMD's
  real `db_fields` map is keyed by each field's long-form *fieldId*, not by its short *answer
  name* — this class used to look answers up by the wrong key entirely, silently prefilling
  nothing. Fixed by resolving fieldId → name via the real `Definition` before the lookup.)
- **`plans`** — Rameltion's own dosage variants (just "8mg" here), rendered as the "Select
  Treatment Plan" radios.
- **`capabilities`** — comes from `AdapterRegistry.for(category)` (`src/payment/adapter-registry.ts`):

```ts
for(category) {
  if (!this.factories.has(category)) return new NullPaymentAdapter();
  return this.resolved.get(category) ?? this.factories.get(category)!();  // built once, memoized
}
```

`category` is `config.payment.adapter ?? channelGenerated.payment_processor.provider_category` —
for this real channel, that's **`checkout_champ`**. `capabilities().rendersOwnCardFields()` being
`true` for this adapter is *why* this page shows raw card-number/expiry/cvc inputs directly (a
different adapter with different capabilities could render a hosted iframe instead — the template
branches on this capability, never on a hardcoded "which provider is this" check).
- **`checkout_visited` event** — fires here, real, confirmed in the log.

---

## 11. `POST /checkout/` — Pay Now, the real charge

**Route:** `src/routes/checkout/checkout.controller.ts` → `CheckoutService.submit()`
(`src/checkout/checkout.service.ts`) — the 10-step order-of-operations:

1. Flood/rate-limit check.
2. Re-price any stored discount code.
3. `BuyerValidator` + `Consents` validated together, one round trip.
4. Geo/territory gate.
5. Buyer + consents written to journey state — **before** any charge is attempted.
6. Idempotency key claimed via a conditional DB insert — a duplicate submit with the same key is
   refused outright, never double-charged.
7. `OrderEnvelope` assembled for the whole cart.
8. The attempt is marked `sent` — **before** calling the payment provider.
9. **`PaymentAdapter.place()`** — resolves (via `AdapterRegistry`, Step 10) to
   `CheckoutChampAdapter` (`src/payment/checkout-champ/checkout-champ-adapter.ts`). Internally this
   is itself two real API calls: `openOrder()` (creates a CheckoutChamp "lead" — a customer record,
   no card data at all) then, only if that succeeds, the real charge attempt
   (`importOrder()`/`preauth()`, carrying the card).
10. On success, `PostChargeGuard.run()` wraps everything after — a failure in any of these must
    never un-charge an already-billed buyer:
    - `DatabaseOrderRecorder` writes the real `orders` row.
    - **`EmrCheckoutEventReporter.orderPlaced()`** fires (`src/checkout/emr-checkout-event-reporter.ts`)
      — reports the placed order to AsterMD's checkout funnel, **and internally also calls
      `treatmentsSynced()`** — the real `client.treatments().sync()` call that tells AsterMD
      "this order was paid, put it in front of a clinician."

**A real, load-bearing detail about that payment call: which offer id gets sent.** A real,
previously-live bug this port found and fixed: a product's variant can carry payment-provider
mappings for *multiple* processors at once (this real Rameltion variant has both a `vrio` mapping
and a `checkout_champ` mapping in AsterMD's raw data). `CatalogBuilder` used to always take
whichever mapping happened to sit first in the array, regardless of which processor is actually
active for this channel — meaning the *wrong* processor's offer id was being sent as CheckoutChamp's
required `campaignId`, and CheckoutChamp correctly refused every single charge attempt outright
("Must provide campaignId") before the card was ever even evaluated. Fixed by matching the mapping
whose own `type` field agrees with the channel's actual `payment_processor.provider_category`.

**Real, complete evidence for one successful order, in exact order, straight from the operator
log:**

```
external.provider.placement    outcome: placed, raw_status: COMPLETE, reference: A2E6AE95AC,
                                settlement: capture, latency_ms: 3832.2
external.emr.checkout_event    operation: order_placed
checkout.order_placed          reference: A2E6AE95AC          (local audit trail — unconditional)
external.emr.checkout_event    operation: journey_completed, opportunity: 6ab51d...
external.emr.treatment_sync    operation: treatments_synced, outcome: ok
completion.journey_completed   orders: 1, declined: 0
```

And the real `orders` row this produced:

```
provider_reference:   "A2E6AE95AC"                    ← CheckoutChamp's own order reference
treatment_reference:  "6ab62f9a702284641d8c3ef5"       ← AsterMD's own treatment id — genuinely
                                                          different from the line above
buyer_email:          "jane.tester@example.com"
card_last_four:       "1111"
idempotency_key:       "63d40801e688daa14facb790f22788a096d932da"
provider_category:    "checkout_champ"
```

`treatment_reference` being a **genuinely different value** from `provider_reference` is itself
proof of a second real bug fixed while building this: the code that reads AsterMD's `sync()`
response used to call `response.data` as if it were a plain property, when it's actually a method
(`response.data()`) — silently always returning nothing, and quietly falling back to just reusing
the order's own reference as a stand-in. Fixed, and now this column holds the real, distinct id
AsterMD assigned.

**Then `GET /thank-you/`** — the receipt page. `FunnelRouter.nextStep()` (Step 4's function) is
asked one more time; with the cart now empty and `state.placedOrders.length > 0`, it returns
`receipt`, and that's the one page an empty cart is allowed to reach without being bounced to
`home`.

---

## What this journey does *not* cover

- **Upsells** (`/upsell/`) — offered between a placed order and the receipt when the flow
  configures one; not part of this particular run.
- **Prequalification** (`/intake/eligibility/`) — a separate questionnaire step some products
  require *before* the medical intake; Rameltion doesn't have one.
- **Identity verification** (`/verify/`) — disabled in this deployment
  (`config/verification.ts`'s `enabled: false`), so `FunnelRouter` never routes there.
- **A declined charge** — this run's card succeeded; see `CheckoutService.submit()`'s own
  10-step list above for exactly what happens on step 9 declining instead (the cart is left
  intact, the idempotency key stays claimed so a retry is safe, and `orderDeclined()` fires on
  `EmrCheckoutEventReporter` instead of `orderPlaced()`).

See `docs/MIDDLEWARE.md` for the pipeline every one of these requests passes through before
reaching any of the code described above.
