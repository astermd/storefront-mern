import { RetentionPolicy } from '../../src/retention/retention-policy';

const NOW = Math.floor(new Date('2026-06-01T00:00:00.000Z').getTime() / 1000);

describe('RetentionPolicy', () => {
  it('derives a cutoff N days before now when the period is well past the reconciliation floor', () => {
    const policy = new RetentionPolicy(90, 365, 30);
    const expected = new Date((NOW - 90 * 86_400) * 1000).toISOString();
    expect(policy.sessionCutoff(NOW)).toBe(expected);
  });

  it('disables expiry (returns null) for a period of zero or less', () => {
    const policy = new RetentionPolicy(0, -1, 0);
    expect(policy.sessionCutoff(NOW)).toBeNull();
    expect(policy.eventCutoff(NOW)).toBeNull();
    expect(policy.logCutoff(NOW)).toBeNull();
  });

  it('floors the session cutoff at RECONCILIATION_FLOOR_SECONDS when the configured period is shorter', () => {
    const policy = new RetentionPolicy(1, 1, 1);
    const floor = new Date((NOW - RetentionPolicy.RECONCILIATION_FLOOR_SECONDS) * 1000).toISOString();

    expect(policy.sessionCutoff(NOW)).toBe(floor);
    expect(policy.eventCutoff(NOW)).toBe(floor);
  });

  it('does NOT floor the log cutoff — neither reconciliation sweep reads a log file', () => {
    const policy = new RetentionPolicy(90, 365, 1);
    const unflooredOneDayAgo = new Date((NOW - 1 * 86_400) * 1000).toISOString();

    expect(policy.logCutoff(NOW)).toBe(unflooredOneDayAgo);
  });

  it('RECONCILIATION_FLOOR_SECONDS is at least as wide as both reconciliation sweeps’ own lookback windows', () => {
    // ReverseReconciliation's default lookback is 2 days; ForwardReconciliation's repeat-failure
    // window is 1 day. Guards against the three drifting apart in silence.
    expect(RetentionPolicy.RECONCILIATION_FLOOR_SECONDS).toBeGreaterThanOrEqual(172_800);
  });
});
