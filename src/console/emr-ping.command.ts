import { ChannelDetail } from '@astermd-hq/sdk';
import { Command, CommandRunner } from 'nest-commander';
import { EmrClientFactory } from '../emr/client-factory';

/**
 * Ported from storefront-lamp/core/Console/PingCommand.php. `emr:ping` — fetches the configured
 * EMR channel and prints a connectivity summary.
 *
 * A read-only operator smoke test, not a scheduled job — unlike `emr:reconcile`/`db:prune`'s
 * `FailureDigest`-only failures (whose stdout is a cron mail spool an EMR/driver's free text must
 * never reach), this prints the exception's own message: an operator running this by hand needs to
 * see "ASTERMD_CLIENT_ID must be set" or a transport error directly, matching the PHP original.
 */
@Command({ name: 'emr:ping', description: 'Fetch the configured EMR channel and print a connectivity summary' })
export class EmrPingCommand extends CommandRunner {
  constructor(private readonly clients: EmrClientFactory) {
    super();
  }

  async run(): Promise<void> {
    try {
      const client = this.clients.create();
      const channelId = this.clients.channelId();
      const response = await client.channels().details(channelId);
      const detail = ChannelDetail.from(response.data());

      const paymentProcessor = detail.payment_processor as { provider?: unknown } | null;

      console.log(`Channel: ${typeof detail.name === 'string' ? detail.name : 'unknown'}`);
      console.log(`Products: ${Array.isArray(detail.products) ? detail.products.length : 0}`);
      console.log(`Provider: ${typeof paymentProcessor?.provider === 'string' ? paymentProcessor.provider : 'unknown'}`);
    } catch (error) {
      console.error(`EMR ping failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}
