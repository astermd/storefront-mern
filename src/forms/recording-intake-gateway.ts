import { Injectable } from '@nestjs/common';
import { Event } from '@astermd-hq/sdk';
import { EventRepository } from '../repository/event-repository';
import { EncodedAnswer } from './answer-encoder';
import { IntakeGateway } from './intake-gateway';

/**
 * Ported from storefront-lamp/core/Forms/RecordingIntakeGateway.php. Writes each intake lifecycle
 * event to the local `events` table on its way to the EMR (`[18.1]`).
 *
 * A decorator rather than a write inside `IntakeSession`, because the two are different concerns
 * and only one of them is optional: the EMR half is switched off with the analytics flag, while the
 * audit trail is not analytics and must be written either way.
 *
 * **Never the answers.** `data` is the encoded answer list and is PHI: what is recorded is the
 * event, the form, the position and how many fields went out — a count cannot leak an answer.
 */
@Injectable()
export class RecordingIntakeGateway implements IntakeGateway {
  constructor(
    private readonly inner: IntakeGateway,
    private readonly events: EventRepository,
  ) {}

  async record(
    session: string,
    event: Event,
    teleformId: string,
    data: EncodedAnswer[],
    progress: { page: number; total: number } | null,
  ): Promise<boolean> {
    const accepted = await this.inner.record(session, event, teleformId, data, progress);

    // A blank session is a journey the EMR could never mint one for (`[20.8]` forbids inventing
    // one), and the table is keyed on it, so there is nothing to file the line under.
    if (session !== '') {
      await this.events.append(session, `intake.${event}`, {
        teleform_id: teleformId,
        fields: data.length,
        page: progress?.page ?? null,
        accepted,
      });
    }

    return accepted;
  }

  /** Passed straight through — the local audit trail records the lifecycle events `record()` reports, not each file upload attempt. */
  async uploadFile(session: string, fileName: string, mimeType: string, buffer: Buffer): Promise<string | null> {
    return this.inner.uploadFile(session, fileName, mimeType, buffer);
  }
}
