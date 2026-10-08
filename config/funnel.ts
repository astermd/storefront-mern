/**
 * Ported verbatim from storefront-lamp/config/funnel.php — which URL is which step, and what must
 * already be true before a visitor may enter it. Requirement names must exist in
 * `src/funnel/step-preconditions.ts`; an unknown name is an error, never a silently-skipped check.
 *
 * `checkout` deliberately omits `prequalification_satisfied`/`intake_satisfied`: this deployment
 * collects the intake questionnaire from the patient portal *after* the order is placed, so a
 * buyer who chose "Proceed to Checkout" must be able to pay with both still outstanding. Both
 * preconditions still exist and are still enforced on `/intake/`, `/intake/medical/` and
 * `/verify/`. `not_disqualified` does NOT come back with them, on purpose — a hard stop is the
 * server's verdict on answers already given and must outlive the completion gate; without it a
 * disqualified visitor could walk from `/not-eligible/` straight to `/checkout/` and pay.
 * `verification_satisfied` stays for the matching reason: `config/verification.ts` ships
 * `enabled: false`, so it already answers true and costs a buyer nothing — but the seam that would
 * enforce it if a deployment turned blocking on must not be deleted.
 */
export const funnelSteps: Record<string, { path: string; requires: string[] }> = {
  home: { path: '/', requires: [] },

  prequalification: { path: '/intake/eligibility/', requires: ['cart_not_empty'] },
  intake: { path: '/intake/', requires: ['cart_not_empty', 'prequalification_satisfied'] },
  'intake.medical': { path: '/intake/medical/', requires: ['cart_not_empty', 'prequalification_satisfied'] },

  // Listed unconditionally and gated by config/verification.ts rather than by presence in this
  // table — a step that appears and disappears can't be guarded (stepForPath() would answer null
  // for /verify/ whenever it was configured away, and an unlisted path is an unguarded one).
  verify: {
    path: '/verify/',
    requires: ['cart_not_empty', 'prequalification_satisfied', 'intake_satisfied'],
  },

  checkout: {
    path: '/checkout/',
    requires: ['cart_not_empty', 'plan_chosen_for_every_rx_line', 'not_disqualified', 'verification_satisfied'],
  },

  // A terminated journey is routed here and has to be able to stay — no requirements of its own.
  not_eligible: { path: '/not-eligible/', requires: [] },

  // An order must exist before either is reachable, and the cart is cleared the moment one is
  // placed, so neither can be guarded on the cart — `order_placed` reads the journey instead.
  upsell: { path: '/upsell/', requires: ['order_placed'] },
  receipt: { path: '/thank-you/', requires: ['order_placed'] },
};
