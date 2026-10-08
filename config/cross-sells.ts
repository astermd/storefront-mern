/**
 * Ported from storefront-lamp/config/cross-sells.php — checkout order bumps: accepted *before*
 * submission, ride along on the main order (distinct from `config/upsells.ts`'s post-purchase
 * upsells, charged *separately* after the first order settles — Phase 8).
 *
 * Empty by default — storefront-lamp's own shipped config is empty too. Populate it when the
 * catalog has something to cross-sell. A prescription offered here joins the order beside the one
 * already in it (`[8.0f]`), and with two or more in the cart every assessment is completed from the
 * patient portal after the order (`[8.0i]`).
 */
export interface CrossSellRow {
  key: string;
  slug: string;
  variant_id?: string | null;
  headline: string;
  body: string;
  position: number;
  price_cents_override?: number | null;
}

export interface CrossSellsConfig {
  byTrigger: Record<string, CrossSellRow[]>;
  maxOnPage: number;
}

export const crossSellsConfig: CrossSellsConfig = {
  byTrigger: {},
  maxOnPage: 3,
};
