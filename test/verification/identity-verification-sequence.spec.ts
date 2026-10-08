import { IdentityGateway } from '../../src/verification/identity-gateway';
import { IdentityVerdict } from '../../src/verification/identity-verdict';
import { IdentityVerificationSequence } from '../../src/verification/identity-verification-sequence';

const CHECKS = [
  { slug: 'crosscheck', required: ['firstName', 'lastName'], narrowing: ['email', 'phone'] },
  { slug: 'dob_verify', required: ['firstName', 'lastName', 'phone', 'dob'], narrowing: ['email'] },
  { slug: 'ssn_verify', required: ['firstName', 'lastName', 'phone', 'ssn'], narrowing: [] },
];

class FakeGateway implements IdentityGateway {
  calls: Array<{ check: string; payload: Record<string, unknown> }> = [];

  constructor(private readonly verdictFor: Record<string, IdentityVerdict>) {}

  async verify(check: string, identity: Record<string, unknown>): Promise<IdentityVerdict> {
    this.calls.push({ check, payload: identity });
    return this.verdictFor[check] ?? IdentityVerdict.inconclusive(check);
  }

  isEnabled(): boolean {
    return true;
  }
}

describe('IdentityVerificationSequence', () => {
  it('skips a check whose required fields are not all present', async () => {
    const gateway = new FakeGateway({});
    const sequence = new IdentityVerificationSequence(gateway, CHECKS);

    await sequence.run({ firstName: 'Jane', lastName: 'Doe' });

    expect(gateway.calls.map((c) => c.check)).toEqual(['crosscheck']);
  });

  it('treats a blank string as absent, not present', async () => {
    const gateway = new FakeGateway({});
    const sequence = new IdentityVerificationSequence(gateway, CHECKS);

    await sequence.run({ firstName: 'Jane', lastName: '   ' });

    expect(gateway.calls).toEqual([]);
  });

  it('stops at the first decisive (non-inconclusive) verdict', async () => {
    const gateway = new FakeGateway({ crosscheck: IdentityVerdict.fromProviderData('crosscheck', { valid: false }) });
    const sequence = new IdentityVerificationSequence(gateway, CHECKS);

    const verdict = await sequence.run({ firstName: 'Jane', lastName: 'Doe', phone: '5551234567', dob: '1990-01-01', ssn: '1234' });

    expect(verdict.isFailed()).toBe(true);
    expect(gateway.calls.map((c) => c.check)).toEqual(['crosscheck']);
  });

  it('runs every satisfiable check in order when all come back inconclusive, returning the last', async () => {
    const gateway = new FakeGateway({});
    const sequence = new IdentityVerificationSequence(gateway, CHECKS);

    const verdict = await sequence.run({ firstName: 'Jane', lastName: 'Doe', phone: '5551234567', dob: '1990-01-01', ssn: '1234' });

    expect(gateway.calls.map((c) => c.check)).toEqual(['crosscheck', 'dob_verify', 'ssn_verify']);
    expect(verdict.check).toBe('ssn_verify');
  });

  it('trims the payload to only the fields the check names, dropping the rest of the identity', async () => {
    const gateway = new FakeGateway({});
    const sequence = new IdentityVerificationSequence(gateway, CHECKS);

    await sequence.run({ firstName: 'Jane', lastName: 'Doe', email: 'jane@example.test', ssn: 'unrelated-to-crosscheck' });

    expect(gateway.calls[0].payload).toEqual({ firstName: 'Jane', lastName: 'Doe', email: 'jane@example.test' });
  });

  it('returns a bare inconclusive() when no check is ever satisfiable', async () => {
    const gateway = new FakeGateway({});
    const sequence = new IdentityVerificationSequence(gateway, []);

    const verdict = await sequence.run({});

    expect(verdict.isInconclusive()).toBe(true);
    expect(gateway.calls).toEqual([]);
  });

  it('drops malformed check entries rather than throwing', () => {
    const gateway = new FakeGateway({});
    expect(() => new IdentityVerificationSequence(gateway, [null, 'not-an-object', { slug: '' }, { required: 'not-an-array' }])).not.toThrow();
  });
});
