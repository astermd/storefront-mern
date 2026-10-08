import { funnelSteps } from '../../config/funnel';
import { FlowDefinition } from '../../src/funnel/flow-definition';
import { StepPreconditions } from '../../src/funnel/step-preconditions';

/**
 * Parity with storefront-lamp's `FunnelReachabilityTest`/`FunnelRulesTest`: every declared step is
 * reachable, no requirement names a precondition `StepPreconditions` doesn't know, and
 * `not_eligible` carries no requirements (it must be reachable from anywhere a disqualified
 * visitor is routed).
 */
describe('FlowDefinition / funnel reachability (Phase 4)', () => {
  const flow = new FlowDefinition(funnelSteps);
  const preconditions = new StepPreconditions(
    { product: () => null },
    { enabled: false, placement: 'intake', blocking: false, checks: [] },
  );

  it('canonicalises every declared path and resolves it back to the same step', () => {
    for (const [name, definition] of Object.entries(flow.allSteps())) {
      expect(flow.stepForPath(definition.path)).toBe(name);
      expect(flow.pathFor(name)).toBe(definition.path);
    }
  });

  it('throws on an unknown step name (pathFor/requirementsFor)', () => {
    expect(() => flow.pathFor('nonexistent')).toThrow(/Unknown funnel step/);
    expect(() => flow.requirementsFor('nonexistent')).toThrow(/Unknown funnel step/);
  });

  it('every requirement named in config/funnel.ts is a precondition StepPreconditions recognises', () => {
    const empty = { lines: () => [], isEmpty: () => true, rxLines: () => [] } as never;

    for (const [step, definition] of Object.entries(flow.allSteps())) {
      for (const requirement of definition.requires) {
        expect(() => preconditions.satisfied(requirement, empty, null)).not.toThrow();
      }
      void step;
    }
  });

  it('throws on an unknown precondition name rather than silently passing', () => {
    const empty = { lines: () => [], isEmpty: () => true, rxLines: () => [] } as never;
    expect(() => preconditions.satisfied('not_a_real_precondition', empty, null)).toThrow(
      /Unknown funnel precondition/,
    );
  });

  it('not_eligible carries no requirements — it must stay reachable from anywhere', () => {
    expect(flow.requirementsFor('not_eligible')).toEqual([]);
  });

  it('home carries no requirements — the entry step must always be enterable', () => {
    expect(flow.requirementsFor(FlowDefinition.ENTRY_STEP)).toEqual([]);
  });

  it('resolves an uncanonical path spelling to the same step stepForPath would from its canonical form', () => {
    expect(flow.stepForPath('/CHECKOUT')).toBe('checkout');
    expect(flow.stepForPath('checkout')).toBe('checkout');
  });

  it('answers null for a path no step declares', () => {
    expect(flow.stepForPath('/no-such-page/')).toBeNull();
  });
});
