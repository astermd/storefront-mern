/**
 * Ported from storefront-lamp/core/Emr/SessionGateway.php. The storefront's whole view of the
 * EMR's analytics-session lifecycle.
 *
 * Everything the request path needs from the EMR about sessions goes through these two calls, for
 * three reasons: session tracking must degrade to "no session" rather than break a page (`[4.5]`,
 * `[20.1]`), so exactly one layer is allowed to swallow; the return-visit reconciliation must be a
 * single read rather than one call per fact (`[4.14]`); and the test suite must never reach the
 * network, which a Null implementation of an interface gives for free.
 */
export interface SessionViewResult {
  exists: boolean;
  opportunityId: string | null;
  events: string[];
}

export interface SessionGateway {
  /**
   * Mints a new analytics session, forwarding the visitor's own agent and IP so the EMR attributes
   * it to their device rather than to this server (`[4.3]`).
   *
   * @returns the new session uuid, or null on any failure — never a synthetic id (`[20.8]`)
   */
  create(
    data: Record<string, unknown>,
    userAgent: string | null,
    clientIp: string | null,
  ): Promise<string | null>;

  /** Reads the server-recorded state of a session once. Null when the read failed. */
  view(uuid: string): Promise<SessionViewResult | null>;
}
