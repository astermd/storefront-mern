/**
 * Ported from storefront-lamp/core/Observability/DeclineBreakdown.php. `[20.12]`'s decline rate, by
 * reason.
 *
 * **A rate, not a count**, because the count alone answers nothing: fifty declines is a bad day at
 * one volume and a broken integration at another. The denominator is every charge attempt in the
 * window — declines plus placements — read from the same trail as the numerator so the two cannot
 * be measured over different populations.
 *
 * **Null is not zero here either.** A window nobody could read reports unavailable, and a window in
 * which nothing was attempted reports no rate at all rather than 0%, because "nobody tried" and
 * "nobody was refused" are different facts and only one of them is good news.
 */
export class DeclineBreakdown {
  private constructor(
    public readonly byReason: Record<string, number> | null,
    public readonly total: number | null,
    public readonly attempts: number | null,
    public readonly failure: string | null = null,
  ) {}

  static of(byReason: Record<string, number>, total: number, attempts: number): DeclineBreakdown {
    return new DeclineBreakdown(byReason, total, attempts);
  }

  static unavailable(failure: string): DeclineBreakdown {
    return new DeclineBreakdown(null, null, null, failure);
  }

  available(): boolean {
    return this.byReason !== null;
  }

  /** Declines as a percentage of every charge attempted, or null when nothing was attempted or read. */
  rate(): number | null {
    if (this.total === null || this.attempts === null || this.attempts === 0) {
      return null;
    }
    return Math.round((this.total / this.attempts) * 1000) / 10;
  }

  toArray(): { by_reason: Record<string, number> | null; total: number | null; attempts: number | null; rate_percent: number | null; failure: string | null } {
    return { by_reason: this.byReason, total: this.total, attempts: this.attempts, rate_percent: this.rate(), failure: this.failure };
  }
}
