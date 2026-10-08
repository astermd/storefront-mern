/**
 * Ported from storefront-lamp/config/upsells.php. Client-owned, not `src/` — a real deployment may
 * edit this file directly.
 *
 * Post-purchase upsells — offers presented *after* a successful charge, each placing its own
 * separate order against the instrument the provider already holds. Distinct from
 * `config/cross-sells.ts`'s checkout order bumps, which ride along on the main order.
 *
 * **Keyed by the upsell, not by the trigger** — the opposite arrangement to cross-sells, and the
 * reason is ordering: exactly one upsell is presented per step (Phase 8), so the offers have to be a
 * single ordered list rather than assembled from several trigger buckets.
 *
 * Ships empty, for the same reason `cross-sells.ts` does: nothing in the current example catalog
 * carries a provider mapping, so nothing here could be charged for even if it were offered.
 */
export interface UpsellRow {
  slug: string;
  variant_id?: string | null;
  offer_after: string[];
  eyebrow?: string;
  headline?: string;
  body?: string;
  bullets?: string[];
  image?: string | null;
  price_cents_override?: number | null;
  accept_label?: string;
  decline_label?: string;
  footnote?: string;
}

export interface UpsellsConfig {
  upsells: Record<string, UpsellRow>;
}

export const upsellsConfig: UpsellsConfig = {
  upsells: {},
};
