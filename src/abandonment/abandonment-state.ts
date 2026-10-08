/**
 * Ported from storefront-lamp/core/Abandonment/AbandonmentState.php. The six abandonment states
 * `[21.10]` requires the storefront to emit.
 *
 * `[21.10]`'s whole demand is that the states be **distinguishable**: a classifier that answered
 * "abandoned" and left the caller to guess which kind, or that let two of these collapse into one
 * another, would satisfy the letter of "emit a state" and none of its purpose — the consuming
 * email automation sends a different message for each one, and a cart nudge sent to somebody whose
 * card was declined is worse than no message at all.
 *
 * The order below is funnel order, and `depth()` makes that order readable by code. A stopped
 * journey usually satisfies more than one of these descriptions at once — someone who reached
 * checkout also has a populated cart — so classification (`AbandonmentClassifier`) is a *deepest
 * evidence wins* ladder rather than six independent predicates.
 *
 * The string values are the wire vocabulary: they are what a polled JSON document carries and what
 * the automation platform branches on, so renaming one is a breaking change for an external
 * consumer rather than a refactor.
 */
export type AbandonmentStateValue =
  | 'cart_abandoned'
  | 'lead_abandoned'
  | 'intake_abandoned'
  | 'checkout_abandoned'
  | 'payment_abandoned'
  | 'upsell_abandoned';

export class AbandonmentState {
  /** Cart populated, then no activity for the configured interval. */
  static readonly Cart: AbandonmentStateValue = 'cart_abandoned';
  /** Name and email captured, no questionnaire ever submitted. */
  static readonly Lead: AbandonmentStateValue = 'lead_abandoned';
  /** A questionnaire started or partly answered, never submitted. */
  static readonly Intake: AbandonmentStateValue = 'intake_abandoned';
  /** Checkout visited, no placement attempted. */
  static readonly Checkout: AbandonmentStateValue = 'checkout_abandoned';
  /** A placement was attempted and produced no order, and was never retried. */
  static readonly Payment: AbandonmentStateValue = 'payment_abandoned';
  /** An upsell was offered and never acted on. */
  static readonly Upsell: AbandonmentStateValue = 'upsell_abandoned';

  /**
   * How far down the funnel this state sits, lowest first. An ordinal, not a score — the gaps
   * between the numbers mean nothing.
   */
  static depth(state: AbandonmentStateValue): number {
    switch (state) {
      case 'cart_abandoned':
        return 1;
      case 'lead_abandoned':
        return 2;
      case 'intake_abandoned':
        return 3;
      case 'checkout_abandoned':
        return 4;
      case 'payment_abandoned':
        return 5;
      case 'upsell_abandoned':
        return 6;
    }
  }
}
