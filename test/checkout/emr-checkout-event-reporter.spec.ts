import { EmrCheckoutEventReporter } from '../../src/checkout/emr-checkout-event-reporter';
import { VerificationGateway } from '../../src/emr/verification-gateway';
import { PaymentDescriptor } from '../../src/payment/payment-descriptor';
import { capturedLog, fakeClients, response } from '../support/fake-emr-client';

const SESSION = 'sess-1';

/** Ported from lamp's EmrCheckoutEventReporterTest payment/verification sync cases. */
describe('EmrCheckoutEventReporter treatmentsSynced', () => {
  function build(opts: { verification?: VerificationGateway | null; email?: string | null; identity?: { status: string; check: string | null; basis: string | null } | null } = {}) {
    const sync = jest.fn().mockResolvedValue(response([{ id: 'tr-1' }]));
    const { log } = capturedLog();
    const events = { append: jest.fn().mockResolvedValue(undefined) };
    const orders = { findByReference: jest.fn().mockResolvedValue(null) };
    const email = opts.email === undefined ? 'ada@example.com' : opts.email;
    const journeyStoreFactory = { get: () => ({ currentState: () => (email === null && !opts.identity ? null : { buyer: { email: email ?? '' }, attribution: null, verification: opts.identity ? { at: 'now', ...opts.identity } : null }) }) };
    const config = { app: { session: { analytics: true } }, get: (_k: string, d: unknown) => d };
    const request = { get: () => 'Mozilla/5.0 (test)' };

    const reporter = new EmrCheckoutEventReporter(
      fakeClients({ treatments: { sync } }),
      events as never,
      orders as never,
      log,
      journeyStoreFactory as never,
      config as never,
      request as never,
      opts.verification ?? null,
    );

    return { reporter, sync, options: () => sync.mock.calls[0][0] as Record<string, unknown> };
  }

  const gateway = (answer: boolean | null, enabled = true): VerificationGateway => ({
    emailIsDeliverable: jest.fn().mockResolvedValue(answer),
    normaliseAddress: jest.fn().mockResolvedValue(null),
    isEnabled: () => enabled,
  });

  it('sends the payment block when there is a descriptor', async () => {
    const t = build();
    await t.reporter.treatmentsSynced(SESSION, ['34660'], new PaymentDescriptor(PaymentDescriptor.TYPE_CREDIT_CARD, true, true, 10850));

    expect(t.options().payment).toEqual({ type: 'credit_card', pre_auth: true, pre_auth_qa: true, pre_auth_amount: 108.5 });
    expect(t.options().userAgent).toBe('Mozilla/5.0 (test)');
  });

  it('sends no payment key when there is none', async () => {
    const t = build();
    await t.reporter.treatmentsSynced(SESSION, ['34660']);

    expect(t.options()).not.toHaveProperty('payment');
  });

  it('reports a deliverable email as the one thing verified', async () => {
    const t = build({ verification: gateway(true) });
    await t.reporter.treatmentsSynced(SESSION, ['34660']);

    expect(t.options().verification).toEqual({ email: true, address: false });
  });

  it.each([
    ['could not run', gateway(null)],
    ['did not pass', gateway(false)],
    ['gateway disabled', gateway(true, false)],
    ['no gateway', null],
  ])('sends no verification key when the check %s', async (_label, verification) => {
    const t = build({ verification });
    await t.reporter.treatmentsSynced(SESSION, ['34660']);

    expect(t.options()).not.toHaveProperty('verification');
  });

  it('verifies nothing for a journey with no buyer yet', async () => {
    const verification = gateway(true);
    const t = build({ verification, email: null });
    await t.reporter.treatmentsSynced(SESSION, ['34660']);

    expect(t.options()).not.toHaveProperty('verification');
    expect(verification.emailIsDeliverable).not.toHaveBeenCalled();
  });

  it.each([
    ['crosscheck', 'cross_check'],
    ['dob_verify', 'dob'],
    ['ssn_verify', 'ssn'],
  ])('reports a decisive %s identity check as method %s, even with no email verified', async (check, method) => {
    const t = build({ email: null, identity: { status: 'passed', check, basis: 'name_phone_match' } });
    await t.reporter.treatmentsSynced(SESSION, ['34660']);

    expect(t.options().verification).toEqual({ email: false, address: false, id: { verified: true, method, value: 'name_phone_match' } });
  });

  it('reports a failed identity check as not verified, with the method as value when there is no basis', async () => {
    const t = build({ verification: gateway(true), identity: { status: 'failed', check: 'dob_verify', basis: null } });
    await t.reporter.treatmentsSynced(SESSION, ['34660']);

    expect(t.options().verification).toEqual({ email: true, address: false, id: { verified: false, method: 'dob', value: 'dob' } });
  });

  it.each([
    ['inconclusive', 'crosscheck'],
    ['passed', 'unknown_check'],
    ['passed', null],
  ])('sends no id for a %s verdict from check %s', async (status, check) => {
    const t = build({ email: null, identity: { status, check, basis: null } });
    await t.reporter.treatmentsSynced(SESSION, ['34660']);

    expect(t.options()).not.toHaveProperty('verification');
  });
});
