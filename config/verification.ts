import { IdentityCheckConfig } from '../src/verification/identity-verification-sequence';

/**
 * Ported from storefront-lamp/config/verification.php — identity verification: where the step
 * sits, whether it stops anybody, and (Phase 6) which identity checks run, in what order, against
 * which fields.
 *
 * Ships disabled: recorded against the live provider integration on 2026-08-25, the real check
 * failed every real identity tested — see the PHP original's docblock for the measurement. Turning
 * this on is a decision that needs a fresh measurement of a real provider, not a config flip.
 */
export interface VerificationConfig {
  /** Master switch. While false the step is not in the funnel at all. */
  enabled: boolean;
  /** One of 'intake' | 'post_checkout' | 'receipt' | 'async' — only 'intake' can gate pre-payment. */
  placement: string;
  /** Whether a failed check stops the visitor advancing (`[22.16]`) — separate from `enabled`. */
  blocking: boolean;
  /** Run in this order until one comes back decisive — see `IdentityVerificationSequence`. */
  checks: IdentityCheckConfig[];
}

export function loadVerificationConfig(env: NodeJS.ProcessEnv): VerificationConfig {
  return {
    enabled: env.IDENTITY_VERIFICATION === 'true',
    placement: 'intake',
    blocking: false,
    checks: [
      { slug: 'crosscheck', required: ['firstName', 'lastName'], narrowing: ['email', 'phone', 'ipAddress', 'address'] },
      { slug: 'dob_verify', required: ['firstName', 'lastName', 'phone', 'dob'], narrowing: ['email', 'address'] },
      { slug: 'ssn_verify', required: ['firstName', 'lastName', 'phone', 'ssn'], narrowing: ['email', 'dob', 'address'] },
    ],
  };
}
