import { Inject } from '@nestjs/common';
import { Command, CommandRunner } from 'nest-commander';
import { PAYMENT_ADAPTER } from '../core/tokens';
import { PaymentAdapter } from '../payment/payment-adapter';

/**
 * Ported from storefront-lamp/core/Console/ProviderPingCommand.php. `provider:ping` — resolves the
 * configured payment adapter and prints a connectivity summary.
 *
 * A read-only operator smoke test. `capabilities()` and `ping()` both pass straight through
 * uninstrumented on `PAYMENT_ADAPTER` (see `InstrumentedPaymentAdapter`'s own doc comment) — this
 * command IS the smoke test, so timing it would file its own output back into itself.
 *
 * Exit 1 if the ping itself reports not-ok, or if resolving the adapter throws at all — printing the
 * exception's own message, matching `emr:ping`'s precedent for a command an operator runs by hand.
 */
@Command({ name: 'provider:ping', description: 'Resolve the configured payment adapter and print a connectivity summary' })
export class ProviderPingCommand extends CommandRunner {
  constructor(@Inject(PAYMENT_ADAPTER) private readonly adapter: PaymentAdapter) {
    super();
  }

  async run(): Promise<void> {
    try {
      const capabilities = this.adapter.capabilities();
      const result = await this.adapter.ping();

      console.log(`Provider: ${capabilities.providerCategory}`);
      console.log(result.detail);
      console.log(`PCI posture: ${capabilities.pciPosture}`);

      if (!result.ok) process.exitCode = 1;
    } catch (error) {
      console.error(`Provider ping failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}
