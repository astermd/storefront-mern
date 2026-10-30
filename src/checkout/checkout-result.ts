import { PlacementOutcome } from '../payment/placement-outcome';
import { Totals } from './totals';

/**
 * Ported from storefront-lamp/core/Checkout/CheckoutResult.php. What one checkout submission came
 * to.
 *
 * Every branch of `CheckoutService.submit()` answers with one of these, including the branches that
 * never reach the provider — a failed validation, an ungranted blocking consent, a geo block, a
 * refused rate limit — carrying a synthesised `PlacementOutcome.declined()` rather than a null
 * outcome, so a caller asking `isPlaced()` gets a truthful answer without first asking which kind of
 * failure it was.
 *
 * `refusedBecause` is the one thing the outcome cannot express: the storefront refused before the
 * provider was reached, for a reason the buyer cannot fix by editing the form — it lets the HTTP
 * layer answer 429 to a flood and 200 to a decline without pattern-matching on a message string.
 *
 * `paymentChallenge` is set only when the payment is waiting on the buyer to verify it with their
 * bank (`[14.22]`): it is what the provider's script on the page needs to run that step, and it is
 * rendered into that one response and kept nowhere.
 */
export class CheckoutResult {
  /** Too many submissions from this address inside the window (`[13.8]`). */
  static readonly REFUSED_RATE_LIMITED = 'rate_limited';
  /** An identical submission is with the provider right now (`[13.37]`). */
  static readonly REFUSED_IN_FLIGHT = 'in_flight';
  /** The attempt could not be claimed at all — the deliberate exception to `[20.1]`'s degrade-silently rule. */
  static readonly REFUSED_UNRECORDABLE = 'unrecordable';

  constructor(
    public readonly outcome: PlacementOutcome,
    public readonly totals: Totals,
    public readonly errors: Record<string, string> = {},
    public readonly notice: string | null = null,
    public readonly redirectTo: string | null = null,
    public readonly refusedBecause: string | null = null,
    public readonly paymentChallenge: string | null = null,
  ) {}

  placed(): boolean {
    return this.outcome.isPlaced();
  }
}
