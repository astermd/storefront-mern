import { Command, CommandRunner } from 'nest-commander';
import { AbandonmentSweep } from '../abandonment/abandonment-sweep';
import { FailureDigest } from '../support/failure-digest';

/**
 * Ported from storefront-lamp/core/Console/AbandonmentCommand.php. `abandonment:signals` — the
 * current set of `[21.10]` abandonment signals, as one JSON document on stdout.
 *
 * **This is `[21.11a]`'s "exposed for polling" half.** There is no outbound push infrastructure and
 * no inbound authentication to put an endpoint behind, so the expected shape is a cron entry piping
 * this into a marketing automation platform's importer.
 *
 * **Read-only, `[20.1]`.** It classifies and prints; it writes nothing but the `[30.7]` access
 * audit row `AbandonmentSweep` itself writes. Running it twice produces the same document (modulo
 * elapsed idle time) — see `AbandonmentSignal.signalKey()` for how a consumer deduplicates.
 *
 * **What the document is.** `{count, generated_at, signals: [...]}` — `count` and `generated_at` so
 * a consumer can tell "no abandonments" from "the poll never ran". A failed read exits non-zero and
 * prints no document at all, for the same reason: a consumer must never read a database outage as
 * "nobody abandoned anything".
 *
 * Exit code 0 means a document was produced — including the empty one, `count: 0` is a measurement.
 * Exit code 1 means the sweep could not read `sessions`; stdout is then empty. The failure line goes
 * to stderr and carries only the exception's class (never the driver's message) — the rows it reads
 * hold clinical answers and buyer contact details.
 *
 * **Handle the output as sensitive.** Every signal carries a resume link, a long-lived bearer
 * credential for a journey's intake answers — it must not be redirected into a durable log, a shell
 * history, or a CI artefact.
 */
@Command({ name: 'abandonment:signals', description: 'Emit the current set of abandoned-journey signals as JSON, for an external system to poll' })
export class AbandonmentCommand extends CommandRunner {
  constructor(private readonly sweep: AbandonmentSweep) {
    super();
  }

  async run(): Promise<void> {
    let signals;
    try {
      signals = await this.sweep.signals();
    } catch (error) {
      // Deliberately stderr, where the rest of this repository's commands write their failures to
      // stdout: this one's stdout is a machine-readable document being piped somewhere, and an
      // error line mixed into it would make a JSON parser fail on the *reporting* rather than on
      // the outage. The class only, never the message — see FailureDigest's own doc comment.
      console.error(`Abandonment sweep failed: ${FailureDigest.describe(error)}`);
      process.exitCode = 1;
      return;
    }

    console.log(
      JSON.stringify(
        {
          count: signals.length,
          generated_at: new Date().toISOString(),
          signals: signals.map((signal) => signal.toArray()),
        },
        null,
        2,
      ),
    );
  }
}
