import { EmrVerificationGateway } from '../../src/emr/emr-verification-gateway';
import { NullVerificationGateway } from '../../src/emr/null-verification-gateway';
import { capturedLog, fakeClients, response } from '../support/fake-emr-client';

/** Ported from lamp 0.0.6's `testEachCheckRunsOnlyUnderItsOwnSwitch` and the Null gateway case. */
describe('verification gateways', () => {
  it('the null gateway reports itself disabled and determines nothing', async () => {
    const gateway = new NullVerificationGateway();

    expect(gateway.isEnabled()).toBe(false);
    expect(await gateway.emailIsDeliverable()).toBeNull();
    expect(await gateway.normaliseAddress()).toBeNull();
  });

  it('each check runs only under its own switch', async () => {
    const verifyEmail = jest.fn().mockResolvedValue(response({ result: 'valid' }));
    const verifyAddress = jest.fn().mockResolvedValue(response({ valid: true, formatted_address: '350 5th Avenue, New York, NY 10118-0110, USA' }));
    const clients = fakeClients({ verification: { verifyEmail, verifyAddress } });
    const { log } = capturedLog();

    const emailOnly = new EmrVerificationGateway(clients, log, true, false);
    const addressOnly = new EmrVerificationGateway(clients, log, false, true);

    expect(await emailOnly.emailIsDeliverable('ada@example.com')).toBe(true);
    expect(await emailOnly.normaliseAddress('350 5th Avenue, New York, NY 10118')).toBeNull();
    expect(await addressOnly.emailIsDeliverable('ada@example.com')).toBeNull();
    expect(await addressOnly.normaliseAddress('350 5th Avenue, New York, NY 10118')).not.toBeNull();
    expect(verifyEmail).toHaveBeenCalledTimes(1);
    expect(verifyAddress).toHaveBeenCalledTimes(1);
    expect(emailOnly.isEnabled()).toBe(true);
    expect(new EmrVerificationGateway(clients, log, false, false).isEnabled()).toBe(false);
  });
});
