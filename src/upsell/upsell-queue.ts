import { Injectable } from '@nestjs/common';
import { JourneyState } from '../journey/journey-state';
import { OperatorLog } from '../support/operator-log';
import { Upsell } from './upsell';
import { Upsells } from './upsells';

/**
 * Ported from storefront-lamp/core/Upsell/UpsellQueue.php. Where in its upsell queue one journey
 * has got to (`[16.3]`–`[16.6]`).
 *
 * **The queue is the record of what was planned; the cursor is the record of what is left.**
 * Nothing here shortens `JourneyState.upsellQueue`, so the trail of what this journey was going to
 * be offered survives the whole flow, and a cursor that has run past the end is simply spent.
 *
 * **Reading the current offer can move the cursor, deliberately.** An entry that no longer resolves
 * is skipped, recorded and advanced past *at the moment it is read* (`[16.4]`), so one request steps
 * over any number of dead entries to reach a live one — a buyer never pays for a misconfiguration in
 * redirects.
 */
@Injectable()
export class UpsellQueue {
  constructor(
    private readonly upsells: Upsells,
    private readonly log: OperatorLog,
  ) {}

  /**
   * The offer to present now, or null when this journey has none left. A cursor past the end
   * answers null rather than reading from the front — the fail-safe direction, since re-reading
   * from the front would re-offer something the buyer may already have been charged for.
   */
  current(state: JourneyState): Upsell | null {
    while (state.upsellCursor < state.upsellQueue.length) {
      const key = state.upsellQueue[state.upsellCursor];

      if (typeof key !== 'string' || key === '') {
        this.log.info('upsell.skipped', { key: null, reason: 'unreadable_entry' });
        state.upsellCursor++;
        continue;
      }

      const upsell = this.upsells.resolve(key);
      if (upsell !== null) {
        return upsell;
      }

      this.log.info('upsell.skipped', { key, reason: 'unresolvable' });
      state.upsellOutcomes[key] = JourneyState.UPSELL_SKIPPED;
      state.upsellCursor++;
    }

    return null;
  }

  /**
   * Records what happened to the offer at the cursor and moves past it. The key is read from the
   * cursor and never inferred from which outcomes are missing — that would sometimes write "charged"
   * onto a key that was skipped earlier.
   */
  advance(state: JourneyState, outcome: string): void {
    const key = state.upsellQueue[state.upsellCursor] ?? null;
    if (typeof key !== 'string' || key === '') {
      return;
    }

    state.upsellOutcomes[key] = outcome;
    state.upsellCursor++;
  }

  /**
   * Whether this journey has any offer left to make (`[16.5]`, `[16.6]`) — answered by asking for
   * the current offer, which also skips the dead entries it walks over.
   */
  isSpent(state: JourneyState): boolean {
    return this.current(state) === null;
  }

  /**
   * How far through the offers this journey is, as "offer n of total". Both figures count only
   * entries that resolve — an entry already recorded as skipped is excluded without being resolved
   * again, so the count settles rather than shifting as the queue is walked.
   */
  position(state: JourneyState): [number, number] {
    let position = 0;
    let total = 0;

    state.upsellQueue.forEach((key, index) => {
      if (typeof key !== 'string' || key === '') return;
      if (state.upsellOutcomes[key] === JourneyState.UPSELL_SKIPPED) return;
      if (this.upsells.resolve(key) === null) return;

      total++;
      if (index <= state.upsellCursor) {
        position++;
      }
    });

    return [position, total];
  }
}
