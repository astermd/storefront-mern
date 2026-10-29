import { Event } from '@astermd-hq/sdk';
import { EncodedAnswer } from '../forms/answer-encoder';
import { IntakeGateway } from '../forms/intake-gateway';
import { Boundary } from './boundary';
import { BoundaryTimer } from './boundary-timer';

/**
 * Ported from storefront-lamp/core/Observability/InstrumentedIntakeGateway.php. `[20.9]` over the
 * progressive-save boundary.
 *
 * A refused save is invisible to the visitor by design — a lost save must never trap someone in a
 * form (`[10.26]`) — so the acceptance rate is the only place a save endpoint that has begun refusing
 * everything becomes visible before the intake completion rate does. How many answers went out is
 * recorded; what they were is not.
 */
export class InstrumentedIntakeGateway implements IntakeGateway {
  constructor(
    private readonly inner: IntakeGateway,
    private readonly timer: BoundaryTimer,
  ) {}

  async record(session: string, event: Event, teleformId: string, data: EncodedAnswer[], progress: { page: number; total: number } | null): Promise<boolean> {
    return this.timer.measure(
      Boundary.FormSave,
      () => this.inner.record(session, event, teleformId, data, progress),
      (accepted) => ({ outcome: accepted ? 'accepted' : 'refused' }),
      { operation: String(event), session, teleform: teleformId, fields: data.length, page: progress?.page ?? null },
    );
  }
}
