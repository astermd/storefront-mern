import { IdentityVerdict } from './identity-verdict';

/**
 * Ported from storefront-lamp/core/Verification/IdentityGateway.php. KYC-style identity checks at
 * `/verify/` — distinct from `EMR_VERIFICATION_GATEWAY` (email/address checks), never conflate the
 * two tokens.
 */
export interface IdentityGateway {
  verify(check: string, identity: Record<string, unknown>): Promise<IdentityVerdict>;

  /** Whether this gateway does anything at all, so a caller can skip the round trip. */
  isEnabled(): boolean;
}
