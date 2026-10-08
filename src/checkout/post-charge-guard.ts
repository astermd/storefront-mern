import { Injectable } from '@nestjs/common';
import { CardScrubber } from '../support/card-scrubber';
import { OperatorLog } from '../support/operator-log';

/**
 * Ported from storefront-lamp/core/Checkout/PostChargeGuard.php. The discipline every write that
 * happens after the money may have moved is subject to.
 *
 * **Past the charge that reverses completely.** Once the payment adapter has returned, the money
 * may have moved, and from that point no failure of ours may reach the buyer as a failure: an error
 * page in front of someone whose card was just debited is the one outcome that leaves nobody with a
 * record of the order. Every write after the call therefore runs in here, which logs what could not
 * be written as a reconciliation item and lets the order stand.
 */
@Injectable()
export class PostChargeGuard {
  constructor(private readonly log: OperatorLog) {}

  /**
   * One step that happens after the money may have moved. Loud rather than silent — the log line is
   * the only thing that will ever tell an operator to go and look — and loud rather than fatal,
   * since the buyer is holding a charged card and an error page in front of them loses the order
   * entirely.
   */
  async run(step: string, reference: string | null, write: () => unknown | Promise<unknown>): Promise<void> {
    try {
      await write();
    } catch (error) {
      this.log.error('checkout.post_charge_write_failed', {
        step,
        reference,
        reason: CardScrubber.scrub(error instanceof Error ? error.message : String(error)),
      });
    }
  }
}
