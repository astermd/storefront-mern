import { EmrCheckoutEventReporter } from '../../src/checkout/emr-checkout-event-reporter';
import { Totals } from '../../src/checkout/totals';
import { capturedLog, response } from '../support/fake-emr-client';

/**
 * The reporter outside a request (the forward reconciliation sweep) and with analytics off:
 * it must build either way, and both cases used to be unreachable.
 */
describe('EmrCheckoutEventReporter outside a request and with analytics off', () => {
  function build(analytics: boolean, withRequest: boolean) {
    const sync = jest.fn().mockResolvedValue(response([{ id: 'tr-1' }]));
    const create = jest.fn().mockResolvedValue(response({}));
    const events = { append: jest.fn().mockResolvedValue(undefined) };
    const orders = { findByReference: jest.fn().mockResolvedValue({ userAgent: 'Mozilla/5.0 (stored on the order)' }), stampTreatmentReference: jest.fn() };
    const config = { app: { session: { analytics } }, verification: { enabled: false }, get: (_k: string, d: unknown) => d };
    const journey = { get: () => ({ currentState: () => null }) };

    const clients = { create: jest.fn(() => ({ treatments: () => ({ sync }), checkoutEvents: () => ({ create }) })) };

    const reporter = new EmrCheckoutEventReporter(
      clients as never,
      events as never,
      orders as never,
      capturedLog().log,
      withRequest ? (journey as never) : null,
      config as never,
      withRequest ? ({ get: () => 'Mozilla/5.0 (request)' } as never) : null,
      null,
    );

    return { reporter, sync, create, events, clients };
  }

  it('syncs a backlog with no request, taking the user agent from the order row', async () => {
    const { reporter, sync } = build(true, false);

    await reporter.treatmentsSynced('sess-1', ['pi_1']);

    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync.mock.calls[0][0]).toMatchObject({ session: 'sess-1', orderIds: ['pi_1'], userAgent: 'Mozilla/5.0 (stored on the order)' });
  });

  it('still writes the local audit trail with analytics off, and tells the EMR nothing', async () => {
    const { reporter, sync, create, events, clients } = build(false, true);

    await reporter.checkoutVisited('sess-1', Totals.of(1000, null));
    await reporter.treatmentsSynced('sess-1', ['pi_1']);

    expect(events.append).toHaveBeenCalled();
    expect(clients.create).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
  });
});
