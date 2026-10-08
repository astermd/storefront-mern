import { LeadGateway } from '../forms/lead-gateway';
import { Boundary } from './boundary';
import { BoundaryTimer } from './boundary-timer';

/**
 * Ported from storefront-lamp/core/Observability/InstrumentedLeadGateway.php. `[20.9]` over the
 * opportunity boundary.
 *
 * `[20.10]` names this one specifically: a rising rate of swallowed opportunity writes means leads
 * are being lost with no error anywhere. `writes()` is deliberately not instrumented — it reaches
 * nothing, answering only whether this deployment writes leads at all, and timing it would log a
 * line for every capture on a deployment that makes no external call.
 *
 * The payload is the visitor's name, email and clinical answers. Only whether it landed is recorded.
 */
export class InstrumentedLeadGateway implements LeadGateway {
  constructor(
    private readonly inner: LeadGateway,
    private readonly timer: BoundaryTimer,
  ) {}

  async create(payload: Record<string, unknown>): Promise<string | null> {
    return this.timer.measure(Boundary.OpportunityWrite, () => this.inner.create(payload), (id) => ({ outcome: id === null ? 'failed' : 'created' }), { operation: 'create' });
  }

  async update(opportunityId: string, payload: Record<string, unknown>): Promise<boolean> {
    return this.timer.measure(
      Boundary.OpportunityWrite,
      () => this.inner.update(opportunityId, payload),
      (accepted) => ({ outcome: accepted ? 'accepted' : 'refused' }),
      { operation: 'update', opportunity: opportunityId },
    );
  }

  writes(): boolean {
    return this.inner.writes();
  }
}
