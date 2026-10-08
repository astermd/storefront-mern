import { JourneyState } from '../journey/journey-state';
import { Cart } from './cart';

/**
 * Ported from storefront-lamp/core/Domain/StepRouter.php. The single question the step guard asks
 * the routing decision — declared as a port so the guard's own branching can be tested against a
 * router that names any step, including ones the shipped table would never produce.
 */
export interface StepRouter {
  nextStep(cart: Cart, state?: JourneyState | null): string;
}
