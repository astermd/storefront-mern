/**
 * Ported from storefront-lamp/config/retention.php. How long each category of data is kept, and
 * what a deletion request can actually reach.
 *
 * §30 states the conflict plainly: privacy regulation gives a person the right to have their data
 * deleted, while medical-records regulation requires clinical records to be kept for years. `[30.2]`
 * resolves it by refusing to treat the data as one category:
 *
 * | category | what it is | on a deletion request |
 * |---|---|---|
 * | marketing | attribution, UTM, affiliate ids, abandonment state, consent | delete — no basis survives withdrawal |
 * | clinical | intake answers, clinician decisions, prescriptions, treatments | retain — the EMR is the authority, not this storefront |
 * | transaction | orders, charges | retain for financial and tax obligations |
 * | operational | sessions, events, logs | delete on this schedule; no long-term basis |
 *
 * `[30.5]` makes these configuration rather than constants, since the correct period varies by
 * jurisdiction. `[30.6]` is why the periods are enforced by `db:prune` rather than by intent — data
 * that is merely supposed to expire does not expire.
 *
 * **What this storefront cannot delete, stated honestly.** `[30.4]` says the storefront is not the
 * authority on clinical retention: it forwards a deletion request to the EMR and reports what the
 * EMR decided. `@astermd-hq/sdk` exposes exactly one deletion route — `sessions().delete()`, which
 * removes an *analytics* session, not a clinical record — so a deletion request against clinical
 * data is an operator procedure carried out in the EMR, not something this application can enact.
 */
export interface RetentionConfig {
  operational: {
    /** Analytics session rows, and the durable journey state they carry. `db:prune` additionally refuses to delete any session an `orders` row points at, at any age — the period is a floor, not an override. */
    sessionDays: number;
    /** The local audit trail (`[18.4]`) — longer than the sessions it describes, since `[30.7]` makes this the record of who read health information and when. */
    eventDays: number;
    /** Files under `storage/logs/`. Short on purpose: the wire log, while it ships off, can hold verbatim card and identity payloads. */
    logDays: number;
  };
  /** Retained: `db:prune` does not delete `orders`/`order_lines`/`order_consents` at any age. Declared here, not enforced. */
  transaction: {
    orderDays: number;
  };
  /** Retained by the EMR, the system of record and the authority (`[30.4]`) — no period here would be honest, since this storefront does not decide it. */
  clinical: {
    authority: 'emr';
    days: null;
  };
  /** Deleted on request, expired with the session that carries it — already governed by `operational.sessionDays`. */
  marketing: {
    follows: 'operational.session_days';
  };
}

export function loadRetentionConfig(env: NodeJS.ProcessEnv): RetentionConfig {
  return {
    operational: {
      sessionDays: Number(env.RETENTION_SESSION_DAYS ?? 90),
      eventDays: Number(env.RETENTION_EVENT_DAYS ?? 365),
      logDays: Number(env.RETENTION_LOG_DAYS ?? 30),
    },
    transaction: {
      orderDays: Number(env.RETENTION_ORDER_DAYS ?? 2557),
    },
    clinical: {
      authority: 'emr',
      days: null,
    },
    marketing: {
      follows: 'operational.session_days',
    },
  };
}
