import { VerificationStatus } from '../journey/journey-state';

/**
 * Ported from storefront-lamp/core/Verification/IdentityVerdict.php. The outcome of one identity
 * check — three states, never just pass/fail, because "the check could not be run" is a real and
 * common third answer this integration must be able to say without pretending it's a failure.
 *
 * Constructed only via the two static factories, matching the PHP original's private constructor.
 */
export class IdentityVerdict {
  private constructor(
    public readonly status: VerificationStatus,
    public readonly check: string | null,
    public readonly basis: string | null,
    public readonly score: number | null,
    public readonly threshold: number | null,
    /** Coded reasons only — never the provider's free-text message. */
    public readonly reasons: string[],
    public readonly cached: boolean,
    /** The provider's own id for this check (`raw.id`): what the EMR files as the patient's identity reference. */
    public readonly reference: string | null = null,
  ) {}

  /** Builds a verdict from the provider's own response envelope. */
  static fromProviderData(check: string, data: Record<string, unknown>): IdentityVerdict {
    const status: VerificationStatus =
      data.valid === true ? 'passed' : data.valid === false ? 'failed' : 'inconclusive';

    const echoedCheck = typeof data.check === 'string' && data.check !== '' ? data.check : check;

    const reasons: string[] = Array.isArray(data.reasons)
      ? data.reasons
          .map((reason) => (reason && typeof reason === 'object' ? (reason as Record<string, unknown>).code : null))
          .filter((code): code is string => typeof code === 'string')
      : [];

    return new IdentityVerdict(
      status,
      echoedCheck,
      typeof data.basis === 'string' ? data.basis : null,
      typeof data.score === 'number' ? data.score : null,
      typeof data.threshold === 'number' ? data.threshold : null,
      reasons,
      data.cached === true,
      IdentityVerdict.referenceIn(data.raw),
    );
  }

  private static referenceIn(raw: unknown): string | null {
    const id = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>).id : null;
    return typeof id === 'string' && id.trim() !== '' ? id : null;
  }

  /** The check could not be run at all — never a pass or a fail. */
  static inconclusive(check: string | null = null, reason: string | null = null): IdentityVerdict {
    return new IdentityVerdict('inconclusive', check, null, null, null, reason !== null ? [reason] : [], false);
  }

  isPassed(): boolean {
    return this.status === 'passed';
  }

  isFailed(): boolean {
    return this.status === 'failed';
  }

  isInconclusive(): boolean {
    return this.status === 'inconclusive';
  }

  /** Safe to log — deliberately excludes every identity field. */
  logContext(): Record<string, unknown> {
    return {
      check: this.check,
      status: this.status,
      basis: this.basis,
      score: this.score,
      threshold: this.threshold,
      reasons: this.reasons,
      cached: this.cached,
    };
  }
}
