import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Injectable, Optional } from '@nestjs/common';

export interface DependencyStatus {
  status: string;
  latency_ms: number | null;
  failure: string | null;
  checked_at: string | null;
  age_seconds: number | null;
}

export interface ReachabilityReport {
  probe: string;
  emr: DependencyStatus;
  provider: DependencyStatus;
}

interface RecordedRun {
  checked_at?: number;
  emr?: { status: string; latency_ms: number; failure: string | null };
  provider?: { status: string; latency_ms: number; failure: string | null };
}

const UNKNOWN = 'unknown';

/**
 * Ported from storefront-lamp/core/Observability/Reachability.php. `[20.15]`'s EMR and
 * payment-provider reachability, without turning the health endpoint into an outage of its own.
 *
 * **`/health/` is polled by load balancers.** A probe that called the EMR and the payment provider
 * on every hit would multiply the poll rate of every monitor and balancer into two external systems.
 * So this class answers two different questions: `cached()` makes no outbound call at all, and
 * `probe()` is the explicit opt-in, rate-limited on top of being opt-in.
 *
 * **The limit's only state is the cache file, so a probe that cannot write it does not run.** The
 * slot is claimed before either call, and the calls happen only if the claim landed — a limiter that
 * cannot remember it ran cannot promise it will not run again.
 *
 * **A probe that throws is `unreachable`, and its message is dropped** — the exception class is
 * recorded and nothing else, since `/health/` is a public unauthenticated document (`[20.14]`).
 */
@Injectable()
export class Reachability {
  static readonly PROBE_NOT_ATTEMPTED = 'not-attempted';
  static readonly PROBE_RAN = 'ran';
  static readonly PROBE_RATE_LIMITED = 'rate-limited';
  static readonly PROBE_REFUSED = 'refused-rate-limit-unrecordable';

  private readonly clock: () => number;

  /**
   * @param emr reaches the EMR the way `emr:ping` does, and answers whether it replied
   * @param provider asks the configured payment adapter whether its credentials reach the provider
   * @param cacheFile where a probe result is recorded so an ordinary probe can report it
   * @param minimumIntervalSeconds the floor between two real probes, whoever asks
   */
  constructor(
    private readonly emr: () => Promise<boolean>,
    private readonly provider: () => Promise<boolean>,
    private readonly cacheFile: string,
    private readonly minimumIntervalSeconds: number = 30,
    @Optional() clock?: () => number,
  ) {
    this.clock = clock ?? (() => Math.floor(Date.now() / 1000));
  }

  /** The last recorded result, or `unknown`. Never calls out. */
  cached(): ReachabilityReport {
    return this.render(this.read(), Reachability.PROBE_NOT_ATTEMPTED);
  }

  /**
   * Probes both dependencies, unless one ran recently enough — or unless the limit cannot be
   * recorded, in which case it does not probe at all. The claim is written before the calls: a
   * probe in flight already looks recent to everybody else.
   */
  async probe(): Promise<ReachabilityReport> {
    const recorded = this.read();
    const checkedAt = recorded.checked_at;
    const now = this.clock();

    if (typeof checkedAt === 'number' && now - checkedAt < this.minimumIntervalSeconds) {
      return this.render(recorded, Reachability.PROBE_RATE_LIMITED);
    }

    if (!this.write({ checked_at: now })) {
      return this.render(recorded, Reachability.PROBE_REFUSED);
    }

    const result: RecordedRun = {
      checked_at: now,
      emr: await this.run(this.emr),
      provider: await this.run(this.provider),
    };

    this.write(result);

    return this.render(result, Reachability.PROBE_RAN);
  }

  /** One dependency, timed, with every failure flattened to "unreachable". */
  private async run(call: () => Promise<boolean>): Promise<{ status: string; latency_ms: number; failure: string | null }> {
    const started = process.hrtime.bigint();
    let ok: boolean;
    let failure: string | null = null;

    try {
      ok = await call();
    } catch (error) {
      ok = false;
      failure = error instanceof Error ? error.constructor.name : 'UnknownError';
    }

    const latencyMs = Math.round((Number(process.hrtime.bigint() - started) / 1_000_000) * 10) / 10;

    return { status: ok ? 'ok' : 'unreachable', latency_ms: latencyMs, failure };
  }

  private render(recorded: RecordedRun, probe: string): ReachabilityReport {
    const checkedAt = typeof recorded.checked_at === 'number' ? recorded.checked_at : null;

    return {
      probe,
      emr: this.dependency(recorded.emr, checkedAt),
      provider: this.dependency(recorded.provider, checkedAt),
    };
  }

  private dependency(recorded: { status: string; latency_ms: number; failure: string | null } | undefined, checkedAt: number | null): DependencyStatus {
    if (recorded === undefined || checkedAt === null) {
      return { status: UNKNOWN, latency_ms: null, failure: null, checked_at: null, age_seconds: null };
    }

    return {
      status: recorded.status,
      latency_ms: typeof recorded.latency_ms === 'number' ? recorded.latency_ms : null,
      failure: recorded.failure ?? null,
      checked_at: new Date(checkedAt * 1000).toISOString(),
      // Never negative: a cache file written by a host whose clock is ahead would otherwise report
      // an age from the future.
      age_seconds: Math.max(0, this.clock() - checkedAt),
    };
  }

  private read(): RecordedRun {
    try {
      const raw = readFileSync(this.cacheFile, 'utf8');
      const decoded: unknown = JSON.parse(raw);
      return decoded && typeof decoded === 'object' ? (decoded as RecordedRun) : {};
    } catch {
      return {};
    }
  }

  /** Records the state, and reports whether it landed — still silent (`[20.1]`), but no longer unobserved. */
  private write(result: RecordedRun): boolean {
    try {
      mkdirSync(dirname(this.cacheFile), { recursive: true, mode: 0o770 });
      writeFileSync(this.cacheFile, JSON.stringify(result));
      return true;
    } catch {
      return false;
    }
  }
}
