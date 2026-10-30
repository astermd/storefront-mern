import { IdentityVerdict } from '../../src/verification/identity-verdict';

describe('IdentityVerdict', () => {
  it('maps valid:true to passed', () => {
    const verdict = IdentityVerdict.fromProviderData('crosscheck', { valid: true, basis: 'score' });
    expect(verdict.isPassed()).toBe(true);
    expect(verdict.status).toBe('passed');
  });

  it('maps valid:false to failed', () => {
    const verdict = IdentityVerdict.fromProviderData('crosscheck', { valid: false });
    expect(verdict.isFailed()).toBe(true);
  });

  it('maps anything else (absent, null, non-boolean) to inconclusive', () => {
    expect(IdentityVerdict.fromProviderData('crosscheck', {}).isInconclusive()).toBe(true);
    expect(IdentityVerdict.fromProviderData('crosscheck', { valid: null }).isInconclusive()).toBe(true);
    expect(IdentityVerdict.fromProviderData('crosscheck', { valid: 'unknown' }).isInconclusive()).toBe(true);
  });

  it('prefers the providers echoed check over the requested one when non-empty', () => {
    const verdict = IdentityVerdict.fromProviderData('crosscheck', { valid: true, check: 'dob_verify' });
    expect(verdict.check).toBe('dob_verify');
  });

  it('falls back to the requested check when the provider echoes nothing', () => {
    const verdict = IdentityVerdict.fromProviderData('crosscheck', { valid: true });
    expect(verdict.check).toBe('crosscheck');
  });

  it('extracts only reason codes, dropping anything else', () => {
    const verdict = IdentityVerdict.fromProviderData('crosscheck', {
      valid: false,
      reasons: [{ code: 'address_invalid', message: 'do not log this' }, { message: 'no code, dropped' }, 'not-an-object'],
    });
    expect(verdict.reasons).toEqual(['address_invalid']);
  });

  it('inconclusive() carries the given reason and never a status other than inconclusive', () => {
    const verdict = IdentityVerdict.inconclusive('ssn_verify', 'unavailable');
    expect(verdict.isInconclusive()).toBe(true);
    expect(verdict.check).toBe('ssn_verify');
    expect(verdict.reasons).toEqual(['unavailable']);
  });

  it('logContext() carries no identity fields, only the safe-to-log shape', () => {
    const verdict = IdentityVerdict.fromProviderData('crosscheck', { valid: true, basis: 'score', score: 0.9, threshold: 0.75, cached: true });
    expect(verdict.logContext()).toEqual({
      check: 'crosscheck',
      status: 'passed',
      basis: 'score',
      score: 0.9,
      threshold: 0.75,
      reasons: [],
      cached: true,
    });
  });

  it('reads the provider reference id from the raw payload', () => {
    const verdict = IdentityVerdict.fromProviderData('ssn_verify', { valid: true, raw: { id: 'dummy-123' } });

    expect(verdict.reference).toBe('dummy-123');
  });

  it.each([[{ valid: true }], [{ valid: true, raw: {} }], [{ valid: true, raw: { id: 42 } }], [{ valid: true, raw: { id: ' ' } }]])('has no reference for %j', (data) => {
    expect(IdentityVerdict.fromProviderData('ssn_verify', data).reference).toBeNull();
  });
});
