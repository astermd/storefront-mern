/**
 * Ported from storefront-lamp/config/abandonment.php. When a stopped journey counts as abandoned,
 * and how far back to look.
 *
 * `[21.12]` makes abandonment detection server-side and time-based rather than a browser event, so
 * these four numbers are the whole definition. They are configuration rather than constants because
 * the right interval is a property of the funnel, not of the software.
 *
 * The signal these produce is read by `abandonment:signals`, which `[21.11a]` exists for — the
 * storefront exposes the state and the marketing platform does the sending.
 *
 * **What the signal carries is a credential.** `[21.11]` requires a resume link, and a resume link
 * restores somebody's intake answers, which are health information. Treat the command's output as
 * PHI: it belongs in the automation platform and nowhere else.
 *
 * **The link is permanent, by decision rather than by omission.** This deployment's link is the raw
 * analytics session identifier — `?amd_session=<uuid>` — it carries no expiry, and completing a
 * journey does not revoke it. The compensating control is the audit trail every emitted signal
 * writes (`[30.7]`).
 */
export interface AbandonmentConfig {
  /** How long a journey must sit unmoved before it is abandoned, measured against `sessions.updatedAt`. */
  idleSeconds: number;
  /** How far back a sweep looks for stopped journeys — matched to the 30-day session cookie lifetime. */
  lookbackSeconds: number;
  /** The most signals one run will emit — a bound rather than a page, since the sweep is a snapshot an external system polls. */
  limit: number;
  /** Which consent key (`config/consent.ts`) carries marketing permission. */
  marketingConsentKey: string;
}

export function loadAbandonmentConfig(env: NodeJS.ProcessEnv): AbandonmentConfig {
  return {
    idleSeconds: Number(env.ABANDONMENT_IDLE_SECONDS ?? 3600),
    lookbackSeconds: Number(env.ABANDONMENT_LOOKBACK_SECONDS ?? 2_592_000),
    limit: Number(env.ABANDONMENT_LIMIT ?? 500),
    marketingConsentKey: env.ABANDONMENT_MARKETING_CONSENT_KEY ?? 'marketing',
  };
}
