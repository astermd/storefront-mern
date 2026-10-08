import { Injectable, Optional } from '@nestjs/common';

/**
 * Ported from storefront-lamp/core/Observability/CorrelationContext.php. `[20.13]`'s correlation
 * identifier, carried in request scope.
 *
 * Debugging one buyer's journey across the storefront, the EMR and the provider without a shared
 * identifier is guesswork. The analytics session uuid already serves that role in payloads
 * (`[13.22]`); the requirement is that it appear in *logs* too — met by making the identifier
 * ambient rather than by editing every log call site.
 *
 * **It resolves rather than being pushed.** The session uuid is minted, adopted or re-minted
 * partway through a request, by whichever middleware got there first — a value captured at any
 * fixed moment would be wrong for the lines on one side of that moment.
 *
 * **Three things can go wrong and all three answer null.** The resolver reaches into the container,
 * so it can throw where the database is gone — precisely when the log line matters most, and a log
 * line that raised the outage it was recording would be worse than one missing a field (`[20.1]`).
 * It can also re-enter: a resolver whose own path logs would call back into this object while it is
 * answering, and the guard turns that into a null instead of unbounded recursion.
 */
@Injectable()
export class CorrelationContext {
  private sessionUuid: string | null = null;
  private resolving = false;

  /** @param resolver reads the journey's identifier, or undefined for a scope that has none */
  constructor(@Optional() private readonly resolver?: () => string | null) {}

  /**
   * Names the journey explicitly, for a scope with no request behind it — a scheduled sweep
   * processes many journeys in one process and has no ambient one; setting this around a batch is
   * what lets its log lines join the same trail as the request that placed the order.
   */
  set(sessionUuid: string | null): void {
    this.sessionUuid = sessionUuid;
  }

  get(): string | null {
    if (this.sessionUuid !== null) {
      return this.sessionUuid;
    }

    if (this.resolver === undefined || this.resolving) {
      return null;
    }

    this.resolving = true;

    try {
      const resolved = this.resolver();
      return typeof resolved === 'string' && resolved !== '' ? resolved : null;
    } catch {
      return null;
    } finally {
      this.resolving = false;
    }
  }
}
