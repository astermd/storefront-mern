import { AsterMDClient, type HttpClient } from '@astermd-hq/sdk';
import { EmrCheckoutEventReporter } from '../../src/checkout/emr-checkout-event-reporter';
import { EmrClientFactory } from '../../src/emr/client-factory';
import { PaymentDescriptor } from '../../src/payment/payment-descriptor';
import { capturedLog } from '../support/fake-emr-client';

/**
 * What actually reaches the wire: the real, installed `@astermd-hq/sdk` client over a stub HTTP
 * client. Guards the assumption `src/emr/treatment-sync-options.ts` documents — that the SDK's
 * `treatments().sync()` serialises `payment` and `verification` as PHP astermd/sdk 0.0.3 does.
 * It fails against an SDK that drops them (stock 0.0.2), which is the signal to update the SDK.
 */
describe('treatments sync on the wire', () => {
  it('sends session, orders, payment and verification to POST /treatments/sync', async () => {
    const sent: Array<{ url: string; method: string; headers: Headers; body: Record<string, unknown> }> = [];

    const httpClient: HttpClient = {
      async sendRequest(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });

        if (url.pathname.endsWith('/api-credentials/token')) {
          return json({ success: true, data: { access_token: 'tok', access_token_expiry: new Date(Date.now() + 3_600_000).toISOString() } });
        }

        sent.push({ url: request.url, method: request.method, headers: request.headers, body: JSON.parse(await request.text()) });
        return json({ success: true, data: { reference: 'trt-1' } });
      },
    };

    const client = new AsterMDClient({ clientId: 'id', clientSecret: 'secret', baseHost: 'emr.test', httpClient });
    const clients = { create: () => client } as unknown as EmrClientFactory;

    const { log } = capturedLog();
    const reporter = new EmrCheckoutEventReporter(
      clients,
      { append: jest.fn().mockResolvedValue(undefined) } as never,
      { findByReference: jest.fn().mockResolvedValue(null) } as never,
      log,
      {
        get: () => ({
          currentState: () => ({
            buyer: { email: 'ada@example.com' },
            attribution: null,
            verification: { status: 'passed', at: 'now', check: 'dob_verify', basis: 'name_dob_match', reference: 'dummy-1793352951978' },
          }),
        }),
      } as never,
      { app: { session: { analytics: true } }, get: (_k: string, d: unknown) => d } as never,
      { get: () => 'Mozilla/5.0 (test)' } as never,
      { isEnabled: () => true, emailIsDeliverable: jest.fn().mockResolvedValue(true), normaliseAddress: jest.fn() } as never,
    );

    await reporter.treatmentsSynced('sess-1', ['34660'], new PaymentDescriptor(PaymentDescriptor.TYPE_CREDIT_CARD, false));

    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe('POST');
    expect(new URL(sent[0].url).pathname).toMatch(/\/treatments\/sync$/);
    expect(sent[0].headers.get('User-Agent')).toBe('Mozilla/5.0 (test)');
    expect(sent[0].body).toEqual({
      session_id: 'sess-1',
      order_ids: ['34660'],
      payment: { type: 'credit_card', pre_auth: false },
      verification: { email: true, address: false, id: { verified: true, method: 'dob', value: 'dummy-1793352951978' } },
    });
  });
});
