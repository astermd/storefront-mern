import { VerificationConfig } from '../../config/verification';
import { JourneyState } from '../journey/journey-state';

/**
 * Ported from storefront-lamp/core/Verification/VerificationPlacement.php. Where the identity step
 * sits, and whether it is still holding this journey.
 *
 * `[22.16]` insists placement and blocking are two settings that must not be conflated — honouring
 * that means two different readers (`FunnelRouter`: where should this visitor be; `StepPreconditions`:
 * may they enter the step they asked for) have to derive their answers from one place, or a guard
 * can refuse a step the router still points visitors at — the self-redirect deadlock this class
 * exists to prevent.
 */
export class VerificationPlacement {
  /** The only placement that can gate a pre-payment step — the other three run at/after checkout. */
  private static readonly PRE_PAYMENT_PLACEMENT = 'intake';

  constructor(private readonly config: VerificationConfig) {}

  /** Whether this deployment runs the step at all, in the funnel — both halves required. */
  collectsBeforePayment(): boolean {
    return this.config.enabled === true && this.config.placement === VerificationPlacement.PRE_PAYMENT_PLACEMENT;
  }

  /** Whether a failed verdict may stop the visitor advancing (`[22.16]`) — separate from placement. */
  blocks(): boolean {
    return this.collectsBeforePayment() && this.config.blocking === true;
  }

  /**
   * Whether the step still has something to ask this journey — true for a journey never asked, and
   * for one that answered and failed under a blocking placement (the step isn't finished with
   * them). Under a non-blocking placement, a recorded failure is itself the answer.
   */
  outstandingFor(state: JourneyState | null): boolean {
    if (!this.collectsBeforePayment()) return false;
    if (state === null || state.verification === null) return true;

    return this.blocks() && !state.verificationPassed();
  }

  /**
   * Whether verification permits this journey past a pre-payment gate — false only where
   * `outstandingFor()` is true *and* the placement blocks, by construction.
   */
  satisfied(state: JourneyState | null): boolean {
    if (!this.blocks()) return true;

    return state !== null && state.verificationPassed();
  }
}
