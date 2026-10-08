/**
 * Ported from storefront-lamp/config/payment.php. Client-owned, not `src/` — a real deployment may
 * edit this file directly.
 *
 * Payment behaviour that is not the provider's own credential block — that lives in
 * `config/channel.generated.ts`'s `payment_processor.config`, written by `theme:sync` and
 * gitignored because it is a live secret. What is here is everything a deployment chooses rather
 * than inherits.
 *
 * `shippingProfileId` has no home in the EMR channel payload and must be set by hand. Vrio refuses
 * any order carrying a payment action without one ("Shipping Method Required"), and refuses a
 * profile that does not belong to the campaign, so a wrong value fails every checkout rather than
 * degrading.
 */
export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

export interface PaymentConfig {
  /** Falls back to the synced channel's provider category. Set only to pin a deployment to one adapter regardless of what sync reports. */
  adapter: string | null;
  currency: string;
  /** Whether an order takes the money at checkout ('capture') or only reserves it ('authorize'). A single product can override this upwards in `config/products.overrides.ts`, never downwards — see `SettlementPolicy`/`SettlementMode.strictest()`. */
  settlement: 'capture' | 'authorize';
  rateLimits: Record<string, RateLimitRule>;
  /** How long a claimed-but-unfinished checkout attempt blocks a retry before the guard assumes the first request died mid-flight. */
  attemptStaleAfterSeconds: number;
  /** Vrio-only: the deployment's shipping profile id, required on every payment-carrying order. */
  shippingProfileId: number;
  checkoutChamp: {
    /**
     * Which of CheckoutChamp's two authorization mechanisms to use. Only consulted when an order
     * settles as 'authorize'; a charge-now order takes the same path either way.
     *
     *   'qa'      — /order/import/ with forceQA:1 puts the order in PENDING review with the FULL
     *               ORDER AMOUNT held on the card, and /order/qa/ releases it. Recommended, and
     *               the default.
     *   'preauth' — /order/preauth/ validates the card with a nominal charge+refund, then
     *               /order/import/ settles. Does NOT reserve the order's value — the older
     *               mechanism, still supported.
     */
    authorizeMode: string;
  };
}

export function loadPaymentConfig(env: NodeJS.ProcessEnv): PaymentConfig {
  const settlement = env.PAYMENT_SETTLEMENT === 'authorize' ? 'authorize' : 'capture';

  return {
    adapter: null,
    currency: 'USD',
    settlement,
    rateLimits: {
      'checkout.submit': { limit: 8, windowSeconds: 300 },
      'checkout.promo': { limit: 20, windowSeconds: 300 },
      'upsell.accept': { limit: 6, windowSeconds: 300 },
    },
    attemptStaleAfterSeconds: 120,
    shippingProfileId: env.PAYMENT_SHIPPING_PROFILE_ID ? Number(env.PAYMENT_SHIPPING_PROFILE_ID) : 1,
    checkoutChamp: {
      authorizeMode: env.PAYMENT_CC_AUTHORIZE_MODE ?? 'qa',
    },
  };
}
