/**
 * Ported from storefront-lamp/core/Observability/Boundary.php. The external calls this storefront
 * makes, named once (`[20.9]`).
 *
 * The storefront sits between two systems it does not own and degrades silently by design
 * (`[20.1]`), which means a broken dependency does not surface as an error — it surfaces as a
 * funnel that quietly stops converting. A class of named constants rather than a string at each
 * call site so the set of boundaries is enumerable, and a boundary that gains a second
 * implementation cannot end up logged under two spellings.
 *
 * The value is the log event's suffix, so every line an operator wants is `external.*` and every
 * line about one dependency is `external.emr.*` or `external.provider.*`.
 */
export type BoundaryValue =
  | 'emr.session'
  | 'emr.cart_mirror'
  | 'emr.form_definition'
  | 'emr.form_save'
  | 'emr.opportunity_write'
  | 'emr.treatment_sync'
  | 'emr.checkout_event'
  | 'provider.placement'
  | 'provider.promotion'
  | 'provider.order_search'
  | 'provider.capture'
  | 'provider.resume';

export class Boundary {
  /** Minting and reading an analytics session (`[4.3]`, `[4.12]`). */
  static readonly EmrSession: BoundaryValue = 'emr.session';
  /** Replacing the remote cart for a session (`[7.12]`). */
  static readonly CartMirror: BoundaryValue = 'emr.cart_mirror';
  /** The teleform metadata read and the signed-URL definition fetch behind it (`[3.6]`). */
  static readonly FormDefinition: BoundaryValue = 'emr.form_definition';
  /** One progressive save of a visitor's answers (`[10.24]`). */
  static readonly FormSave: BoundaryValue = 'emr.form_save';
  /** Creating or amending the opportunity a lead becomes (`[9.7]`). */
  static readonly OpportunityWrite: BoundaryValue = 'emr.opportunity_write';
  /** Telling the EMR about orders the provider has already charged (`[17.2]`). */
  static readonly TreatmentSync: BoundaryValue = 'emr.treatment_sync';
  /** The funnel events of §17 — travel the same transport as the treatment sync and fail the same way. */
  static readonly CheckoutEvent: BoundaryValue = 'emr.checkout_event';
  /** Submitting an order to the payment provider (`[13.24]`). */
  static readonly ProviderPlacement: BoundaryValue = 'provider.placement';
  /** Validating and pricing a promotion code (`[13.14]`). */
  static readonly PromotionQuote: BoundaryValue = 'provider.promotion';
  /** Asking the provider what orders it holds, for the reverse sweep (`[21.9a]`). */
  static readonly ProviderOrderSearch: BoundaryValue = 'provider.order_search';
  /** Settling an order that was authorized rather than charged. */
  static readonly ProviderCapture: BoundaryValue = 'provider.capture';
  /** Re-reading an order a challenge left pending, once the buyer has answered it (`[14.22]`). */
  static readonly ProviderResume: BoundaryValue = 'provider.resume';
}
