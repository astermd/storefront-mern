import { Injectable, Optional } from '@nestjs/common';
import { FailureDigest } from '../support/failure-digest';
import { OperatorLog } from '../support/operator-log';
import { BoundaryValue } from './boundary';

/**
 * Ported from storefront-lamp/core/Observability/BoundaryTimer.php. `[20.9]`: one external call,
 * timed, with its outcome named.
 *
 * **This class may not change what happens.** It measures a call and returns whatever the call
 * returned; an exception passes through untouched so the caller's own failure policy — swallow and
 * log for analytics (`[20.2]`), stop the buyer for payment (`[20.3]`) — is exactly what it was
 * before the instrumentation existed. Every line of bookkeeping here is wrapped in its own catch:
 * `[20.1]` says tracking must never break the storefront.
 *
 * **Latency is measured with `process.hrtime.bigint()`**, Node's monotonic clock — the direct
 * equivalent of PHP's `hrtime()` — so a clock adjustment mid-call cannot produce a negative duration.
 *
 * **What may go into the context, and what may not** (`[20.14]`). Outcome codes drawn from this
 * application's own vocabulary, counts, latency, and identifiers this codebase issued are safe.
 * Anything composed by the EMR or the provider is not — a failure is named by its exception class,
 * never by its message.
 */
@Injectable()
export class BoundaryTimer {
  private readonly clock: () => bigint;

  constructor(
    private readonly log: OperatorLog,
    @Optional() clock?: () => bigint,
  ) {
    this.clock = clock ?? (() => process.hrtime.bigint());
  }

  /**
   * Runs `call`, records what happened, and hands back its result. `describe` turns the call's own
   * return value into the outcome fields for the log line, and runs inside this class's error
   * boundary — a describer that throws costs the detail on one line and nothing else, recorded as
   * `undescribed` rather than `ok`.
   */
  async measure<T>(
    boundary: BoundaryValue,
    call: () => Promise<T> | T,
    describe?: (result: T) => Record<string, unknown>,
    context: Record<string, unknown> = {},
  ): Promise<T> {
    const started = this.clock();

    let result: T;
    try {
      result = await call();
    } catch (error) {
      this.record(boundary, 'error', {
        ...context,
        outcome: 'exception',
        latency_ms: this.elapsed(started),
        failure: error instanceof Error ? error.constructor.name : 'UnknownError',
        prisma_code: FailureDigest.errorCode(error),
      });
      throw error;
    }

    const latency = this.elapsed(started);
    let described: Record<string, unknown>;

    if (describe !== undefined) {
      try {
        described = describe(result);
      } catch {
        described = { outcome: 'undescribed' };
      }
    } else {
      described = { outcome: 'ok' };
    }

    this.record(boundary, 'info', { ...context, ...described, latency_ms: latency });

    return result;
  }

  /** Writes the line, and cannot fail. */
  private record(boundary: BoundaryValue, level: 'error' | 'info', context: Record<string, unknown>): void {
    try {
      const event = `external.${boundary}`;
      const filtered = Object.fromEntries(Object.entries(context).filter(([, value]) => value !== null && value !== undefined));

      if (level === 'error') {
        this.log.error(event, filtered);
      } else {
        this.log.info(event, filtered);
      }
    } catch {
      // See the class docblock.
    }
  }

  /** Milliseconds to one decimal place: sub-millisecond calls are real and rounding them to zero hides them. */
  private elapsed(started: bigint): number {
    const nanos = Number(this.clock() - started);
    return Math.round((nanos / 1_000_000) * 10) / 10;
  }
}
