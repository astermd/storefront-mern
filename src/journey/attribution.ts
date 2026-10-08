/**
 * Reduced port of storefront-lamp/core/Attribution/Attribution.php for Phase 2. The attribution
 * captured for one journey: canonical parameters, the landing referrer, and (eventually) the
 * values derived from them.
 *
 * Immutable by construction — attribution is captured once on first touch and never overwritten
 * for the life of the journey (`[5.12]`); `firstTouch()` keys off the existence of an existing
 * instance, not its emptiness, so an empty landing referrer still counts as a capture (`[5.13]`).
 *
 * Deliberately reduced from the PHP original for this phase: the encrypted `_amd` payload
 * (`AmdPayload::decode`, tracking-key rotation) and derived device/browser/OS/source-category
 * parsing (`AttributionNormalizer`, `DerivedAttribution`) are not built yet — `derived` fields are
 * always null until a later pass adds real user-agent parsing. What's ported now (capture from
 * plain query params + referrer, first-touch precedence, the EMR session payload shape) is
 * complete and correct as far as it goes.
 */
export interface DerivedAttribution {
  sourceCategory: string | null;
  sourceDetail: string | null;
  deviceType: string | null;
  browser: string | null;
  os: string | null;
}

export interface AttributionData {
  params: Record<string, string>;
  referrer: string | null;
  derived: DerivedAttribution;
}

const EMPTY_DERIVED: DerivedAttribution = {
  sourceCategory: null,
  sourceDetail: null,
  deviceType: null,
  browser: null,
  os: null,
};

export class Attribution {
  private constructor(
    readonly params: Readonly<Record<string, string>>,
    readonly referrer: string | null,
    readonly derived: Readonly<DerivedAttribution>,
  ) {}

  static capture(plainQuery: Record<string, unknown>, referrer: string | null): Attribution {
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(plainQuery)) {
      if (typeof value === 'string' && value !== '') {
        params[key] = value;
      }
    }

    const sorted = Object.fromEntries(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)));
    const trimmedReferrer = referrer === null ? null : referrer.trim();

    return new Attribution(sorted, trimmedReferrer, EMPTY_DERIVED);
  }

  /** Whatever was captured first stands (`[5.12]`, `[5.13]`). */
  static firstTouch(existing: Attribution | null, incoming: Attribution): Attribution {
    return existing ?? incoming;
  }

  get(key: string): string | null {
    return this.params[key] ?? null;
  }

  isEmpty(): boolean {
    return Object.keys(this.params).length === 0 && (this.referrer === null || this.referrer === '');
  }

  toArray(): AttributionData {
    return { params: { ...this.params }, referrer: this.referrer, derived: { ...this.derived } };
  }

  static fromArray(data: AttributionData): Attribution {
    return new Attribution(data.params ?? {}, data.referrer ?? null, { ...EMPTY_DERIVED, ...data.derived });
  }

  /**
   * The attribution the EMR session-creation call would carry (`[4.4]`): the landing referrer and
   * the UTM triple. Channel binding and geo are derived server-side by the EMR and deliberately
   * not sent. Unused while `SESSION_GATEWAY` is Null-bound, but kept so the shape survives into a
   * real integration unchanged.
   */
  emrSessionPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {};

    if (this.referrer) {
      payload.referrer = this.referrer;
    }

    const utm = Object.fromEntries(
      (['source', 'medium', 'campaign'] as const)
        .map((key) => [key, this.get(`utm_${key}`)] as const)
        .filter(([, value]) => value !== null),
    );
    if (Object.keys(utm).length > 0) {
      payload.utm = utm;
    }

    return payload;
  }
}
