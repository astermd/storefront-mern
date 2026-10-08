import { PlacementOutcome } from '../payment/placement-outcome';

/**
 * Ported from storefront-lamp/core/Upsell/UpsellResult.php. What answering one offer amounts to:
 * somewhere to go, and at most something to say.
 *
 * **`redirectTo` is not nullable, and that is the type carrying `[16.11]`.** Its counterpart
 * `CheckoutResult` has a nullable `redirectTo` — a checkout decline means the buyer stays and tries
 * again. Here they have already paid for what they came for, so every path ends somewhere further
 * forward.
 *
 * `notice` is for the two things the buyer can act on — a flood refusal and a charge that may still
 * be in flight — and nothing else. A declined add-on carries none.
 */
export class UpsellResult {
  constructor(
    public readonly redirectTo: string,
    public readonly notice: string | null = null,
    public readonly outcome: PlacementOutcome | null = null,
  ) {}
}
