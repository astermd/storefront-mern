/**
 * Ported from storefront-lamp/core/Emr/VerificationGateway.php. Address and email checks against
 * the EMR's configured third-party providers.
 *
 * Every method returns `null` for "could not determine", which is a third distinct answer from
 * yes and no. An undeterminable answer never blocks an order — these checks improve a form; they
 * do not gate a purchase.
 *
 * This is `EMR_VERIFICATION_GATEWAY` — a distinct port from `IDENTITY_GATEWAY` (KYC checks at
 * `/verify/`). Never conflate the two tokens.
 */
export interface VerificationGateway {
  /** True, false, or null when the check could not be run. */
  emailIsDeliverable(email: string): Promise<boolean | null>;

  /** The normalised address, or null when the check could not be run. */
  normaliseAddress(address: string): Promise<Record<string, string> | null>;

  /** Whether this gateway does anything at all, so a caller can skip the round trip. */
  isEnabled(): boolean;
}
