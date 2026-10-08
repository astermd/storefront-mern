import { JourneyState } from '../journey/journey-state';

/**
 * Ported from storefront-lamp/core/Funnel/FurthestStep.php. The one place that decides whether a
 * journey has got further than it had, and the only writer of `JourneyState.furthestStep`'s
 * advance rule (`[21.7]`).
 *
 * `ORDER` is declared here rather than derived from `config/funnel.ts`'s array order, deliberately:
 * that config's order is a step *vocabulary*, not a progression — `not_eligible` sits between
 * `checkout` and `upsell` there while being a terminal off-ramp reachable from anywhere, which is
 * why it has no rung here at all (it isn't a step anybody completes).
 *
 * Monotonic, because a visitor who reached checkout and went back to edit their questionnaire has
 * not un-reached checkout — every writer calls `advance()` rather than assigning.
 */
export class FurthestStep {
  static readonly ORDER = [
    'home',
    'prequalification',
    'intake',
    'intake.medical',
    'verify',
    'checkout',
    'upsell',
    'receipt',
  ];

  /** Records that this journey has now completed `step`, if that is further than it had already got. */
  static advance(state: JourneyState | null, step: string): void {
    if (state === null || !FurthestStep.isBeyond(state.furthestStep, step)) return;

    state.furthestStep = step;
  }

  /**
   * Whether `candidate` is further along the funnel than `current`. An unrecognised candidate is
   * refused outright (it would put a name into the record no consumer can turn back into a URL);
   * an unrecognised current value is overwritten (it can only be a stale spelling, and blocking on
   * it would freeze the field permanently).
   */
  static isBeyond(current: string | null, candidate: string): boolean {
    const rank = FurthestStep.ORDER.indexOf(candidate);
    if (rank === -1) return false;
    if (current === null) return true;

    const held = FurthestStep.ORDER.indexOf(current);
    return held === -1 || rank > held;
  }
}
