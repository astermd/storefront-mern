const SESSION_KEY = '_amd_rate_limits';

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

/**
 * Ported from storefront-lamp/core/Support/RateLimiter.php. A fixed-window counter per key, kept
 * in the visitor's own session.
 *
 * **State the limitation plainly, because the name promises more than this delivers.** The
 * counters live in the session, so the limit is per browser session and is bypassed by discarding
 * the cookie. That is adequate for what it is used for — the intake form's early-capture
 * endpoint, where the thing being prevented is one visitor's script or a stuck retry loop flooding
 * a lead write. It is **not** adequate for checkout or anything else where the caller is motivated
 * to get around it (`[13.8]`, `[29.23]`) — use a database-backed limiter there instead.
 *
 * A fixed window (rather than a sliding one) is chosen for the same reason: two integers per key,
 * no history to store, and its known weakness — up to twice the limit across a window boundary —
 * does not matter when the goal is stopping a flood rather than enforcing a quota.
 *
 * Takes the session object explicitly (rather than reaching for a global) since Express keeps
 * session state on `req.session`, not in a process-wide superglobal.
 */
export class RateLimiter {
  private readonly clock: () => number;

  /**
   * @param limit how many calls one key may make inside a window
   * @param windowSeconds how long a window lasts before the count resets
   * @param clock the current unix timestamp; defaults to the real one
   */
  constructor(
    private readonly limit: number,
    private readonly windowSeconds: number,
    clock?: () => number,
  ) {
    this.clock = clock ?? (() => Math.floor(Date.now() / 1000));
  }

  /**
   * Whether this call is within the allowance, counting it if it is.
   *
   * A refusal deliberately does not extend the window — a caller that keeps hammering is refused
   * for the remainder of the current window and no longer.
   */
  allow(session: Record<string, unknown>, key: string): boolean {
    const now = this.clock();
    const limits = (session[SESSION_KEY] && typeof session[SESSION_KEY] === 'object' ? session[SESSION_KEY] : {}) as Record<
      string,
      RateLimitEntry
    >;

    const entry = limits[key];
    let started = entry?.windowStart ?? null;
    let count = entry?.count ?? 0;

    // A window that has run out — or a clock that went backwards, which a machine's time
    // correction can do — starts a fresh one.
    if (started === null || now - started >= this.windowSeconds || now < started) {
      started = now;
      count = 0;
    }

    const allowed = count < this.limit;
    if (allowed) count++;

    limits[key] = { count, windowStart: started };
    session[SESSION_KEY] = limits;

    return allowed;
  }
}
