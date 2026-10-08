import { IdentityGateway } from '../../src/verification/identity-gateway';
import { NullIdentityGateway } from '../../src/verification/null-identity-gateway';

describe('NullIdentityGateway', () => {
  it('always answers inconclusive, never passed — locked down permanently', async () => {
    const gateway: IdentityGateway = new NullIdentityGateway();
    const verdict = await gateway.verify('crosscheck', { firstName: 'Jane' });
    expect(verdict.isInconclusive()).toBe(true);
    expect(verdict.isPassed()).toBe(false);
    expect(verdict.reasons).toEqual(['disabled']);
  });

  it('isEnabled() is always false', () => {
    expect(new NullIdentityGateway().isEnabled()).toBe(false);
  });
});
