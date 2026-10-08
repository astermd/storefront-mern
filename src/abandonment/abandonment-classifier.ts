import { CheckoutEvent } from '@astermd-hq/sdk';
import { FORM_IN_PROGRESS, JourneyState } from '../journey/journey-state';
import { AbandonmentState, AbandonmentStateValue } from './abandonment-state';

/**
 * Ported from storefront-lamp/core/Abandonment/AbandonmentClassifier.php. Which of `[21.10]`'s six
 * states one stopped journey is in, decided from durable server-side state alone.
 *
 * **Deepest evidence wins, and that is the whole design.** A stopped journey almost always
 * satisfies several of the six descriptions at once: someone whose card was declined also has a
 * populated cart, a captured lead, a submitted questionnaire and a visited checkout, and every one
 * of those facts is still sitting on the row. Six independent predicates would therefore answer
 * "yes" five times and leave the caller to guess, so the rungs are ordered by `AbandonmentState.depth()`
 * and the deepest one that holds is the answer.
 *
 * **Nothing here is time-based.** "Has this journey stopped moving" is `sessions.updatedAt` and
 * belongs to `AbandonmentSweep`; this class answers only "where had it got to". `[20.1]`: read-only —
 * it mutates nothing on the state it is handed and writes nothing anywhere.
 */
export class AbandonmentClassifier {
  /**
   * The state this journey stopped in, or null when it is not abandoned at all.
   *
   * Null is an ordinary, frequent answer and never an error: a visitor who landed and left took no
   * step to abandon, a journey the server ruled ineligible is not waiting to be nudged, and a
   * completed purchase is the opposite of an abandonment.
   */
  classify(state: JourneyState): AbandonmentStateValue | null {
    // `[17.1]`: a journey with a completion timestamp bought and finished. It also still carries
    // the checkout visit and the placed order that several rungs below read, so this guard comes
    // before the ladder rather than being folded into it.
    if (state.isComplete()) {
      return null;
    }

    // `[10.46]`: a disqualification is the server's standing verdict that this visitor may not
    // proceed. Inviting them back to a funnel that will stop them again is worse than sending
    // nothing, and the verdict is durable precisely so a resumed journey still finds it.
    if (state.isDisqualified()) {
      return null;
    }

    // A placed order settles every rung below the upsell at once: the buyer reached the end of the
    // purchase, so nothing earlier was abandoned — even though the cart, lead, checkout-visit and
    // consent evidence for those rungs is all still standing on this row.
    if (state.placedOrders.length > 0) {
      return AbandonmentClassifier.offerLeftUnanswered(state) ? AbandonmentState.Upsell : null;
    }

    let deepest: AbandonmentStateValue | null = null;

    for (const [candidate, holds] of AbandonmentClassifier.evidence(state)) {
      if (holds && (deepest === null || AbandonmentState.depth(candidate) > AbandonmentState.depth(deepest))) {
        deepest = candidate;
      }
    }

    return deepest;
  }

  /**
   * What each rung's condition actually reads on this journey, in the enum's own order.
   *
   * - **Cart** — `[21.10]`'s "cart populated". The durable copy (`[19.8]`), not a PHP-session
   *   working copy no sweep could see.
   * - **Lead** — "name and email captured", read as *the EMR holds an opportunity for this
   *   journey* (`[11.6]`'s threshold is exactly a first name and an email) — definition-free, so a
   *   sweep never has to load a form to know whether a lead exists.
   * - **Intake** — "started or partially completed, never submitted" is `formStatus` holding
   *   `in_progress` for some teleform.
   * - **Checkout** — "checkout visited" is the `checkout_visited` funnel event, recorded once per
   *   journey and durable in `emrEvents`.
   * - **Payment** — "placement attempted and declined", read from the `order_declined` funnel
   *   event rather than inferred — the event is stamped only where the provider actually answered,
   *   unlike the consents, which are also true of a submission refused before the provider was
   *   ever reached (a geo block, a rate limit).
   * - **Upsell** — see `offerLeftUnanswered()`.
   */
  private static evidence(state: JourneyState): Array<[AbandonmentStateValue, boolean]> {
    return [
      [AbandonmentState.Cart, state.cart.lines.length > 0],
      [AbandonmentState.Lead, state.opportunityId !== null],
      [AbandonmentState.Intake, Object.values(state.formStatus).includes(FORM_IN_PROGRESS)],
      [AbandonmentState.Checkout, state.hasEmrEvent(CheckoutEvent.CheckoutVisited)],
      [AbandonmentState.Payment, state.hasEmrEvent(CheckoutEvent.OrderDeclined)],
    ];
  }

  /**
   * Whether an offer was shown and never answered (`[21.10]`'s "upsell offered, never acted on").
   *
   * `offered` is written when the offer page renders and is *replaced* by the outcome the moment
   * the buyer answers, so a surviving `offered` is precisely an offer that was put in front of
   * someone who then walked away. An empty outcome map means no offer was ever shown, which is not
   * an abandonment.
   */
  private static offerLeftUnanswered(state: JourneyState): boolean {
    return Object.values(state.upsellOutcomes).includes(JourneyState.UPSELL_OFFERED);
  }
}
