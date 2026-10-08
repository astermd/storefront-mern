/**
 * Ported from storefront-lamp/core/Payment/CheckoutChamp/CheckoutChampAuthorizeMode.php. Which of
 * CheckoutChamp's two authorization mechanisms to use for an order that settles as `authorize`
 * (a charge-now order takes the same path either way):
 *
 *   'qa'      — `/order/import/` with `forceQA:1` puts the order in PENDING review with the FULL
 *               ORDER AMOUNT held on the card, and `/order/qa/` releases it. The provider
 *               recommends this, and it is the default: a later capture is far less likely to
 *               decline because the money is genuinely reserved.
 *   'preauth' — `/order/preauth/` validates the card by charging a nominal amount and refunding
 *               it, then `/order/import/` settles. It does NOT reserve the order's value, so by
 *               capture time the funds may be gone and the settle call can decline. Older, still
 *               supported.
 */
export type CheckoutChampAuthorizeModeValue = 'qa' | 'preauth';

export class CheckoutChampAuthorizeMode {
  static readonly Qa: CheckoutChampAuthorizeModeValue = 'qa';
  static readonly Preauth: CheckoutChampAuthorizeModeValue = 'preauth';

  /** An unrecognised spelling returns `null` — never guessed. */
  static parse(value: unknown): CheckoutChampAuthorizeModeValue | null {
    if (typeof value !== 'string') return null;
    const normalised = value.toLowerCase().trim();
    return normalised === CheckoutChampAuthorizeMode.Qa || normalised === CheckoutChampAuthorizeMode.Preauth ? (normalised as CheckoutChampAuthorizeModeValue) : null;
  }

  static holdsTheOrderAmount(mode: CheckoutChampAuthorizeModeValue): boolean {
    return mode === CheckoutChampAuthorizeMode.Qa;
  }
}
