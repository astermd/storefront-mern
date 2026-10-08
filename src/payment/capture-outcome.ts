/**
 * Ported from storefront-lamp/core/Payment/CaptureOutcome.php. No `amountCents` by design — a
 * capture settles the provider's own held figure.
 */
export class CaptureOutcome {
  static readonly CAPTURED = 'captured';
  static readonly FAILED = 'failed';
  static readonly UNSUPPORTED = 'unsupported';

  private constructor(
    public readonly state: string,
    public readonly reference: string | null,
    public readonly reason: string | null,
  ) {}

  static captured(reference: string): CaptureOutcome {
    return new CaptureOutcome(CaptureOutcome.CAPTURED, reference, null);
  }

  static failed(reference: string | null, reason: string): CaptureOutcome {
    return new CaptureOutcome(CaptureOutcome.FAILED, reference, reason);
  }

  static unsupported(): CaptureOutcome {
    return new CaptureOutcome(CaptureOutcome.UNSUPPORTED, null, null);
  }

  isCaptured(): boolean {
    return this.state === CaptureOutcome.CAPTURED;
  }
}
