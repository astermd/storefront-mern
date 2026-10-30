# Stripe port plan

Port of the Stripe payment provider from storefront-lamp (`core/Payment/Stripe/`, lamp commits
`dde270d`, `474f7d3`, `fed4c8c`, `a7a67f8`) to storefront-mern. Nothing here is implemented yet.

## Findings that shape the plan

- **No coupons in the SDK yet.** `@astermd-hq/sdk` is `0.0.2` (also the latest on npm) and has no
  `coupons()`. Lamp's CHANGELOG says discount codes appear once the SDK offers it. The coupon
  gateway therefore ships with a Null implementation, and the promo box stays hidden on Stripe
  channels until the SDK adds it.
- **`stripe` package version.** Lamp uses `stripe-php ^22`; npm's latest `stripe` is `23.0.1`
  (stable). Install `stripe@latest` per `CLAUDE.local.md`, then re-check the API version lamp pins
  in `StripeApiFactory` against it.
- **Shared payment code changes.** The `/checkout/confirm/` flow (the buyer's bank asking for
  verification) is generic. Lamp added `supportsClientAction` to `AdapterCapabilities` and
  `resume()` to `PaymentAdapter`. MERN has neither. Vrio and CheckoutChamp must keep stopping the
  checkout exactly as they do today.
- **Nothing is verified against real Stripe.** Lamp's tests are built from Stripe's documented
  shapes (`docs/INTEGRATION-NOTES.md` items 31–34). The first test-mode run should record a
  placement, a decline, a verification and a hold.
- **DB-backed e2e suites cannot run in the agent environment** (Prisma's AI-agent guard on
  `db push --accept-data-loss`), so checkout/confirm coverage is unit tests plus a manual smoke
  test.

## How Stripe works in lamp

- The card is entered in Stripe's own fields and never reaches the server. The page mints a
  confirmation token; the server confirms a PaymentIntent with it.
- One Stripe customer per email, found before it is created. The saved customer and card pay for
  upsells.
- Idempotent at Stripe as well as in the storefront: the key is the storefront key plus the token.
- The EMR builds the treatment from the PaymentIntent, so the payload is written for that reader:
  `amount_details` line items, an `astermd_line_items` entry per line (same count, same order),
  `astermd_order_type` (`cycle` needs a plan entry), the customer email, and `astermd_session_id`.
  A line with no EMR ids is refused before Stripe is called.
- Discount codes are the EMR's coupons, priced again just before the payment is created. A code
  that ran out is refused before Stripe is called and dropped from the order.
- A held payment (`settlement: authorize`) is captured by the EMR when the doctor completes the
  case. The adapter refuses to capture it itself, and refuses to hold for a cart with no
  prescription or for an upsell.
- A line whose variant the EMR sells on a subscription plan is sold on that plan at its first
  payment, and the order renews.

## Phases

### 1. Shared payment layer (first; edits existing files)

- `AdapterCapabilities`: add `supportsClientAction`, `supportsRecurring`,
  `supportsAuthorizeCapture`, the provider-hosted collection surface and `clientConfig`.
- `PaymentAdapter`: add `resume(reference)`.
- `PlacementOutcome`: add a "requires action" outcome.
- Update `PromotionQuote`, `OrderLine`, `OrderEnvelope`, `CardDescriptor`, `NullPaymentAdapter`
  and `Boundary` to match lamp.
- Vrio and CheckoutChamp declare `supportsClientAction = false`.
- Exit check: existing Vrio and CheckoutChamp tests stay green.

### 2. Stripe adapter (`src/payment/stripe/`)

- Files: `stripe-adapter.ts`, `stripe-payload.ts`, `stripe-outcome.ts`, `stripe-credentials.ts`,
  `stripe-api-factory.ts`, `stripe-refusing-transport.ts` (blocks live calls under test).
- Register as `stripe` in `src/core/core.module.ts`, with the refusing transport when
  `app.env === 'test'`.
- `payment:capture` skips Stripe orders (the EMR captures holds).

### 3. Coupon gateway (`src/emr/`)

- `CouponGateway` port, `NullCouponGateway`, and `EmrCouponGateway` wired to `coupons()` when the
  SDK offers it. Bind Null until then.

### 4. Subscription plans and `theme:sync`

- New `src/catalog/subscription-plans.ts`: plans assigned to the channel in the EMR, each priced at
  its first payment from its own steps, on Stripe channels only.
- `catalog-builder.ts` and `theme-sync.command.ts` handle plans (`PLAN_PROVIDERS = ['stripe']`).

### 5. Checkout and browser side

- `public/js/payment-stripe.js` ported from lamp: Stripe.js loaded from Stripe's own domain,
  Elements, confirmation token, and the bank-verification step.
- `views/pages/checkout.ejs`: Stripe card surface instead of the theme's card fields.
- `CheckoutService` handles the "requires action" outcome; new `/checkout/confirm/` route finishes
  the order through `resume()`.
- Hide the promo box on Stripe channels while the coupon gateway is Null.

### 6. Config, docs, tests

- `config/payment.ts`: Stripe keys and rate buckets. Update `.env.example` and `config-validate`.
- `STATUS.md` and `docs/INTEGRATION-NOTES.md` (items 31–34).
- Jest ports of `StripeAdapterTest`, `StripeCredentialsTest`, `RefusingTransportTest`, plus a
  `FakeStripeTransport` helper in `test/support/`.
- Regression tests that Vrio and CheckoutChamp still stop the checkout on a client action.

## Order of work

Phase 1 first. Phases 2, 3 and 4 can then run in parallel (disjoint files). Phase 5 follows 1–3.
Phase 6 runs alongside each phase.

## Open questions

- Which Stripe API version to pin once on `stripe@latest`.
- Whether to wait for `coupons()` in the SDK or ship Stripe without discount codes first.
