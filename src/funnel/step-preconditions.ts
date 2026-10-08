import { Cart } from '../domain/cart';
import { ProductCatalog } from '../domain/product-catalog';
import { JourneyState } from '../journey/journey-state';
import { VerificationConfig } from '../../config/verification';
import { VerificationPlacement } from '../verification/verification-placement';
import { FunnelRules } from './funnel-rules';

export type PreconditionName =
  | 'cart_not_empty'
  | 'plan_chosen_for_every_rx_line'
  | 'prequalification_satisfied'
  | 'intake_satisfied'
  | 'not_disqualified'
  | 'order_placed'
  | 'verification_satisfied';

/**
 * Ported from storefront-lamp/core/Funnel/StepPreconditions.php. The named predicates
 * `config/funnel.ts` refers to.
 *
 * Named rather than expressed as closures in config so the flow stays declarative data, and so an
 * unknown name fails loudly: a mistyped requirement that quietly evaluated true would leave a step
 * unguarded and look exactly like a step that had none.
 *
 * The two form preconditions are **satisfied-or-not-required**, never "completed" — a cart with
 * nothing to ask goes straight to checkout (`[8.3]`). A journey that could not be loaded at all is
 * a **third** answer, not "not satisfied yet": the two questionnaire gates fail closed (`[8.6]`)
 * and `order_placed` fails open (`[20.1]`) — answering them all the same way is what would lock a
 * buyer who just paid out of their own receipt.
 */
export class StepPreconditions {
  private readonly rules: FunnelRules;
  private readonly placement: VerificationPlacement;

  constructor(catalog: ProductCatalog, verification: VerificationConfig) {
    this.rules = new FunnelRules(catalog);
    this.placement = new VerificationPlacement(verification);
  }

  satisfied(requirement: string, cart: Cart, state: JourneyState | null): boolean {
    switch (requirement as PreconditionName) {
      case 'cart_not_empty':
        return !cart.isEmpty();
      case 'plan_chosen_for_every_rx_line':
        return FunnelRules.everyRxLineHasAPlan(cart);
      case 'prequalification_satisfied':
        return this.prequalificationSatisfied(cart, state);
      case 'intake_satisfied':
        return this.intakeSatisfied(cart, state);
      case 'not_disqualified':
        return this.notDisqualified(cart, state);
      case 'order_placed':
        return StepPreconditions.orderPlaced(state);
      case 'verification_satisfied':
        return this.placement.satisfied(state);
      default:
        throw new Error(`Unknown funnel precondition "${requirement}".`);
    }
  }

  /**
   * Whether the server has already stopped this journey (`[10.45]`, `[10.46]`). Published
   * separately from `intakeSatisfied()` because `/checkout/` requires this one and not that one —
   * the questionnaire is collected post-purchase, but a hard stop must still outlive that gate.
   */
  private notDisqualified(cart: Cart, state: JourneyState | null): boolean {
    if (state !== null) {
      return !state.isDisqualified();
    }
    return this.rules.intakeForms(cart).length === 0 && this.rules.prequalificationForms(cart).length === 0;
  }

  /** Whether the intake questionnaire this cart calls for has been completed, or never called for one (`[8.3]`). */
  private intakeSatisfied(cart: Cart, state: JourneyState | null): boolean {
    if (this.rules.intakeForms(cart).length === 0) return true;
    if (state === null) return false;

    return !state.isDisqualified() && this.rules.outstandingIntakeForm(cart, state) === null;
  }

  /** Whether the dedicated eligibility step has been completed, for the products that ask for one (`[8.2]`). */
  private prequalificationSatisfied(cart: Cart, state: JourneyState | null): boolean {
    if (this.rules.prequalificationForms(cart).length === 0) return true;
    if (state === null) return false;

    return !state.isDisqualified() && this.rules.outstandingPrequalificationForm(cart, state) === null;
  }

  /**
   * Whether this journey has bought something — assumed true when there is no journey to ask,
   * since by receipt time the money's already moved (`[20.1]`); refusing a buyer their own receipt
   * because the database blinked is worse than showing a stranger an empty one.
   */
  private static orderPlaced(state: JourneyState | null): boolean {
    return state === null || state.placedOrders.length > 0;
  }
}
