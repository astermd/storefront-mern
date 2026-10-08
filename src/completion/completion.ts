import { Inject, Injectable } from '@nestjs/common';
import { CheckoutEventReporter } from '../checkout/checkout-event-reporter';
import { PostChargeGuard } from '../checkout/post-charge-guard';
import { CHECKOUT_EVENT_REPORTER } from '../core/tokens';
import { FurthestStep } from '../funnel/furthest-step';
import { JourneyState } from '../journey/journey-state';
import { JourneyStoreFactory } from '../journey/journey-store-factory';
import { OrderRepository } from '../repository/order-repository';
import { CardScrubber } from '../support/card-scrubber';
import { ConfigService } from '../support/config';
import { OperatorLog } from '../support/operator-log';
import { OrderRowForReceipt, Receipt } from './receipt';
import { ReceiptViewModel } from './receipt-view-model';

const RECEIPT_STEP = 'receipt';

/**
 * Ported from storefront-lamp/core/Completion/Completion.php. What reaching the receipt does: the
 * completion actions once, then teardown (`[17.1]`–`[17.7]`).
 *
 * **The order of the steps is the whole class.** `wipeForCompletion()` clears the attribution the
 * treatment sync forwards (`[17.4]`) and the buyer contact the receipt's shipping block is built
 * from (`[4.16]`), so every action that reads journey state runs before it and the wipe is the last
 * thing that happens.
 *
 * **Fire-once is a durable flag, not a request-scoped one** (`[17.1]`, `[4.15]`). A refresh of the
 * receipt re-enters this class, finds `JourneyState.isComplete()` true, and renders the stored
 * snapshot without re-firing anything.
 *
 * **Every action is individually wrapped, and the guard is still set when one fails** — `[20.1]`
 * forbids any failure here from reaching the buyer, since the money has already moved.
 *
 * **No case id is rendered** — the EMR's treatment record carries a null `provider_case_id` at the
 * moment a treatment is created, so there is nothing true to print.
 */
@Injectable()
export class Completion {
  constructor(
    private readonly journeyStoreFactory: JourneyStoreFactory,
    private readonly orders: OrderRepository,
    @Inject(CHECKOUT_EVENT_REPORTER) private readonly events: CheckoutEventReporter,
    private readonly guard: PostChargeGuard,
    private readonly log: OperatorLog,
    private readonly config: ConfigService,
  ) {}

  /**
   * Completes the journey if it has not been completed, and answers with the page either way.
   * Never throws: this is the last page of a purchase, and the visitor is entitled to it whatever
   * the storefront can or cannot prove about them (`[20.1]`).
   */
  async complete(): Promise<ReceiptViewModel> {
    const journeyStore = this.journeyStoreFactory.get();
    const state = journeyStore.currentState();

    if (state === null) {
      return ReceiptViewModel.empty(this.currency());
    }

    if (state.isComplete()) {
      return ReceiptViewModel.fromReceipt(Receipt.fromArray(state.receipt ?? {}));
    }

    // `[17.6]` and `[17.4]`: read before anything clears them.
    const opportunityId = state.opportunityId;
    const sessionUuid = journeyStore.sessionUuid();

    const { receipt, readable, unrecorded } = await this.receiptFor(state);
    const reference = receipt.references[0] ?? null;

    // A journey whose orders could not be read has not completed — reporting it would tell the EMR
    // a charged order declined, and freezing the snapshot would make that permanent.
    if (!readable) {
      this.log.error('completion.deferred', {
        session: sessionUuid,
        placed_orders: state.placedOrders.length,
        reason: 'an order could not be read, so nothing about this journey is safe to report yet',
      });

      return ReceiptViewModel.fromReceipt(receipt);
    }

    const placed = Completion.placedReferences(state, receipt, unrecorded);

    if (unrecorded.length > 0) {
      this.log.warning('completion.placement_not_recorded', {
        session: sessionUuid,
        references: unrecorded,
        reason: 'the journey placed these and no local row holds them, so the reported totals exclude them',
      });
    }

    await this.guard.run('completion.final_event', reference, () =>
      this.events.journeyCompleted(
        sessionUuid,
        placed.length > 0,
        receipt.subtotalCents,
        receipt.paidTotalCents,
        placed.length === 0 ? null : receipt.paymentMethod,
        placed.length > 0 ? placed : receipt.declinedReferences,
        opportunityId,
      ),
    );

    if (placed.length > 0) {
      await this.guard.run('completion.treatment_sync', reference, () => this.events.treatmentsSynced(sessionUuid, placed));
    }

    state.receipt = receipt.toArray();
    state.completedAt = new Date().toISOString();
    state.sessionRetired = true;

    // `[21.7]`: deliberately after the deferral branch above — a journey whose orders could not be
    // read has not completed, and stamping the final step on one would say it had.
    FurthestStep.advance(state, RECEIPT_STEP);

    state.wipeForCompletion();

    this.log.info('completion.journey_completed', { session: sessionUuid, orders: receipt.references.length, declined: receipt.declinedReferences.length });

    // Built from the snapshot's own source rather than re-read from the now-wiped state, so the
    // first render and every later one are the same page.
    return ReceiptViewModel.fromReceipt(receipt);
  }

  /**
   * The receipt for everything this journey placed. `placedOrders` is the reference list rather
   * than a query by session, because it survives the wipe for exactly that reason. A reference with
   * no row costs a line on the receipt rather than the receipt itself.
   */
  private async receiptFor(state: JourneyState): Promise<{ receipt: Receipt; readable: boolean; unrecorded: string[] }> {
    const rows: OrderRowForReceipt[] = [];
    let complete = true;
    const unrecorded: string[] = [];

    for (const reference of state.placedOrders) {
      try {
        const row = await this.orders.findByReference(reference);
        if (row !== null) {
          rows.push(row);
        } else {
          // The read worked and there is nothing to find: the money moved before the local write
          // and the write was lost.
          unrecorded.push(reference);
        }
      } catch (error) {
        // A read that threw is not a row that was absent — an unreadable table means we do not know
        // what this journey bought, and every figure derived from it is a guess.
        complete = false;
        this.log.error('completion.order_unreadable', {
          reference,
          session: this.journeyStoreFactory.get().sessionUuid(),
          reason: CardScrubber.scrub(error instanceof Error ? error.message : String(error)),
        });
      }
    }

    return { receipt: Receipt.fromOrderRows(rows, state.buyer, this.currency()), readable: complete, unrecorded };
  }

  /**
   * What this journey placed, as opposed to what could be read back. `placedOrders` and the receipt
   * answer different questions, and only the second may legitimately be blank — deriving "did this
   * journey place anything" from the rows would report a charged order as declined the moment one
   * `INSERT` failed. Only a reference with no row at all is taken from the journey; a row that WAS
   * read and says the order was not placed is not promoted.
   */
  private static placedReferences(state: JourneyState, receipt: Receipt, unrecorded: string[]): string[] {
    return state.placedOrders.filter((reference) => receipt.references.includes(reference) || unrecorded.includes(reference));
  }

  private currency(): string {
    return String(this.config.get('payment.currency', 'USD'));
  }
}
