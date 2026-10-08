import { BoundaryTimer } from '../../src/observability/boundary-timer';
import { Instrumentation } from '../../src/observability/instrumentation';
import { NullLeadGateway } from '../../src/forms/null-lead-gateway';
import { OperatorLog } from '../../src/support/operator-log';

/**
 * Proves Phase 10's own "Done" bar: an `Instrumented*` wrapper records a call even though the
 * wrapped Null implementation does nothing at all. `NullLeadGateway.create()` always returns
 * `null` and touches no I/O — if a call to the wrapped gateway still produces a log line, the
 * decorator is genuinely observing the call rather than the underlying port's own behavior.
 */
describe('Instrumentation', () => {
  it('wraps a Null gateway so a call is still recorded on the operator log', async () => {
    const log = new OperatorLog('/dev/null');
    const infoSpy = jest.spyOn(log, 'info').mockImplementation(() => undefined);

    const timer = new BoundaryTimer(log);
    const instrumentation = new Instrumentation(timer);

    const wrapped = instrumentation.leadGateway(new NullLeadGateway());
    const result = await wrapped.create({ email: 'buyer@example.com' });

    expect(result).toBeNull();
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledWith('external.emr.opportunity_write', expect.objectContaining({ operation: 'create', outcome: 'failed' }));
  });

  it('passes `writes()` straight through, uninstrumented — no log line for a call that reaches nothing', async () => {
    const log = new OperatorLog('/dev/null');
    const infoSpy = jest.spyOn(log, 'info').mockImplementation(() => undefined);

    const timer = new BoundaryTimer(log);
    const instrumentation = new Instrumentation(timer);

    const wrapped = instrumentation.leadGateway(new NullLeadGateway());
    expect(wrapped.writes()).toBe(false);
    expect(infoSpy).not.toHaveBeenCalled();
  });
});
