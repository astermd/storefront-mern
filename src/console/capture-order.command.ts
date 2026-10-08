import { Inject } from '@nestjs/common';
import { Command, CommandRunner } from 'nest-commander';
import { PAYMENT_ADAPTER } from '../core/tokens';
import { CaptureOutcome } from '../payment/capture-outcome';
import { CaptureRequest } from '../payment/capture-request';
import { OrderLine } from '../payment/order-line';
import { PaymentAdapter } from '../payment/payment-adapter';
import { SettlementMode } from '../payment/settlement-mode';
import { OrderRepository } from '../repository/order-repository';

/**
 * Ported from storefront-lamp/core/Console/CaptureOrderCommand.php. `payment:capture <reference>`
 * — takes the money on an order that was authorized rather than charged.
 *
 * **This is the seam, not the trigger.** What decides *when* an authorization settles is a
 * clinical or fulfilment event that happens outside this storefront, and deliberately stays
 * outside it — so there is no scheduler and no sweep here. Whatever system owns that event runs
 * this command with the reference it is settling, the same way an operator would.
 *
 * **It takes the provider's reference, not a local id** — what `orders.providerReference` holds,
 * what the receipt shows the buyer, and what an operator reads off the provider's own dashboard.
 *
 * **The local row is consulted before the provider is**, and its only job is to stop obvious
 * mistakes cheaply: an order this storefront never recorded, or one already settled as a capture,
 * is refused without a network call.
 *
 * **Never writes back to the local `orders` row on success**, matching the PHP original exactly —
 * all state after a successful capture lives only in the provider's own record. Exit codes are the
 * interface: 0 on capture, 1 on every refusal — the caller is a script that needs to know whether
 * to alert, not which of several things went wrong.
 */
@Command({ name: 'payment:capture', description: 'Capture an order that was authorized at checkout rather than charged' })
export class CaptureOrderCommand extends CommandRunner {
  constructor(
    @Inject(PAYMENT_ADAPTER) private readonly adapter: PaymentAdapter,
    private readonly orders: OrderRepository,
  ) {
    super();
  }

  async run(params: string[]): Promise<void> {
    const reference = (params[0] ?? '').trim();

    if (reference === '') {
      console.error('A provider order reference is required.');
      process.exitCode = 1;
      return;
    }

    let row;
    try {
      row = await this.orders.findByReference(reference);
    } catch {
      console.error(
        `The local record for ${reference} could not be read, and it is the only place this order's lines still exist. Fix the database and retry; the authorization is untouched.`,
      );
      process.exitCode = 1;
      return;
    }

    if (row === null) {
      console.error(`No local order is recorded against reference ${reference}. Check it against the provider before capturing by hand.`);
      process.exitCode = 1;
      return;
    }

    if (row.settlement !== SettlementMode.Authorize) {
      console.error(`Order ${reference} was recorded as ${row.settlement}, not as an authorization, so there is nothing held to capture.`);
      process.exitCode = 1;
      return;
    }

    const capabilities = this.adapter.capabilities();
    if (!capabilities.supportsAuthorizeCapture) {
      console.error(`The configured provider (${capabilities.providerCategory}) does not support authorize-and-capture, so it holds nothing to settle.`);
      process.exitCode = 1;
      return;
    }

    // Rebuilt from the local `order_lines` rather than from anything read from the provider: for
    // at least one provider, a pre-authorized order holds an empty item list until the settling
    // call fills it in, so re-reading from the provider would return the same empty list.
    const lines = row.lines.map(
      (line) => new OrderLine(line.slug, line.name, CaptureOrderCommand.nullableText(line.providerOffer), CaptureOrderCommand.nullableText(line.providerItem), line.unitPriceCents, line.quantity, line.kind),
    );

    const outcome = await this.adapter.capture(new CaptureRequest(reference, lines));

    if (outcome.isCaptured()) {
      console.log(`Captured order ${reference}.`);
      return;
    }

    console.error(`Capture of order ${reference} was not completed (${outcome.state === CaptureOutcome.UNSUPPORTED ? 'unsupported' : outcome.reason}).`);
    process.exitCode = 1;
  }

  private static nullableText(value: string | null): string | null {
    return value !== null && value.trim() !== '' ? value.trim() : null;
  }
}
