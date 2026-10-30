/**
 * Injection tokens for every port — the direct equivalent of the PHP-DI bindings in
 * storefront-lamp's AppFactory. A controller or service depends on the interface behind one of
 * these tokens, never the concrete (Null or real) implementation directly.
 *
 * Two naming notes, both deliberate departures from a naive 1:1 name transcription:
 * - `EMR_VERIFICATION_GATEWAY` and `IDENTITY_GATEWAY` are two distinct ports that both involve
 *   the word "verification" in the PHP original (`Emr\VerificationGateway` — email/address aid,
 *   gated by `app.features.emr_verification` — vs. `Verification\IdentityGateway` — KYC checks at
 *   `/verify/`, gated by `verification.enabled`). Naming them identically here would invite a
 *   binding mix-up that the PHP original's separate namespaces prevent.
 * - `PAYMENT_ADAPTER` resolves through `AdapterRegistry` (a resolve-by-category-with-catch-to-Null
 *   factory), not a config-gated ternary like the other nine ports — see `payment/adapter-registry.ts`
 *   (Phase 7).
 */
export const SESSION_GATEWAY = Symbol('SessionGateway');
export const CART_GATEWAY = Symbol('CartGateway');
export const EMR_VERIFICATION_GATEWAY = Symbol('EmrVerificationGateway');
export const TELEFORM_GATEWAY = Symbol('TeleformGateway');
export const INTAKE_GATEWAY = Symbol('IntakeGateway');
export const INTAKE_UPLOADS = Symbol('IntakeUploads');
export const ADDRESS_AUTOFILL = Symbol('AddressAutofill');
export const COUPON_GATEWAY = Symbol('CouponGateway');
export const LEAD_GATEWAY = Symbol('LeadGateway');
export const IDENTITY_GATEWAY = Symbol('IdentityGateway');
export const PAYMENT_ADAPTER = Symbol('PaymentAdapter');
export const ORDER_RECORDER = Symbol('OrderRecorder');
export const CHECKOUT_EVENT_REPORTER = Symbol('CheckoutEventReporter');

// Infrastructure tokens — not ports in the PHP original's sense, but still bound once in
// CoreModule so nothing outside it constructs them directly.
export const DATABASE_CONNECTION = Symbol('DatabaseConnection');
export const EMR_CLIENT = Symbol('EmrClient');

/**
 * The `Domain\ProductCatalog` port — no Null counterpart in the PHP original (it's not an external
 * system that degrades, it's config-derived data that's foundational). Bound to `CatalogProvider`
 * (Phase 5), which merges `config/products.generated.ts` and `config/products.overrides.ts`.
 */
export const PRODUCT_CATALOG = Symbol('ProductCatalog');

/**
 * `Domain\StepRouter` — bound to `FunnelRouter` in production. Kept as a token rather than
 * injecting the concrete class directly so `StepGuardMiddleware`'s branching can be tested against
 * a router that names any step, including ones the shipped table would never produce (matching the
 * PHP original's own reasoning for declaring this as an interface).
 */
export const STEP_ROUTER = Symbol('StepRouter');
