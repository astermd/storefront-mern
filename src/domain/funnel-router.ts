import { VerificationConfig } from '../../config/verification';
import { FunnelRules } from '../funnel/funnel-rules';
import { JourneyState } from '../journey/journey-state';
import { VerificationPlacement } from '../verification/verification-placement';
import { Cart } from './cart';
import { ProductCatalog } from './product-catalog';
import { StepRouter } from './step-router';

/**
 * Ported from storefront-lamp/core/Domain/FunnelRouter.php. Where this visitor should be right
 * now (`[8.1]`).
 *
 * Deliberately *not* a forward-only table: the guard asks this of a visitor who has just failed a
 * precondition, so an answer that ignored what they'd already finished would send someone who
 * completed a questionnaire back to the start of it. It's also the answer to "where does an
 * unsatisfied step send someone" — with an empty cart every funnel step is unsatisfied, and only
 * this decision knows what the right answer to that is.
 *
 * Shares `FunnelRules`/`VerificationPlacement` with `StepPreconditions` on purpose (see
 * `funnel-rules.ts`'s doc comment) — the routing decision and the guard that acts on it must never
 * hold different opinions about the same cart.
 */
export class FunnelRouter implements StepRouter {
  private readonly rules: FunnelRules;
  private readonly placement: VerificationPlacement;

  constructor(catalog: ProductCatalog, verification: VerificationConfig) {
    this.rules = new FunnelRules(catalog);
    this.placement = new VerificationPlacement(verification);
  }

  nextStep(cart: Cart, state: JourneyState | null = null): string {
    // A terminated journey outranks everything else, including an empty cart (`[10.46]`).
    if (state !== null && state.isDisqualified()) {
      return 'not_eligible';
    }

    if (cart.isEmpty()) {
      // An empty cart on a journey that has bought something is the *after* picture, not an idle
      // visitor's — `[13.32]` clears the cart the moment an order is placed. The receipt is what
      // that visitor is owed, and it's reachable precisely because `order_placed` is satisfied.
      return state !== null && state.placedOrders.length > 0 ? 'receipt' : 'home';
    }

    // An Rx line with no chosen plan cannot be priced or ordered (`[12.7]`).
    if (!FunnelRules.everyRxLineHasAPlan(cart)) {
      return 'home';
    }

    if (this.rules.outstandingPrequalificationForm(cart, state) !== null) {
      return 'prequalification';
    }

    if (this.rules.outstandingIntakeForm(cart, state) !== null) {
      return 'intake.medical';
    }

    // Identity verification, when this deployment runs it before payment (`[22.13]`, `[22.14]`).
    // Asked via the same `VerificationPlacement` the guard asks, so the two can never disagree.
    if (this.placement.outstandingFor(state)) {
      return 'verify';
    }

    return 'checkout';
  }
}
