import { DatabaseOrderRecorder } from '../../src/checkout/database-order-recorder';
import { Buyer } from '../../src/payment/buyer';
import { OrderEnvelope } from '../../src/payment/order-envelope';
import { OrderLine } from '../../src/payment/order-line';
import { PaymentCredential } from '../../src/payment/payment-credential';
import { PlacementOutcome } from '../../src/payment/placement-outcome';
import { SettlementMode } from '../../src/payment/settlement-mode';
import { capturedLog } from '../support/fake-emr-client';

/** The card's last four on the order row: from the number when the storefront saw one, otherwise from the provider. */
describe('DatabaseOrderRecorder card_last_four', () => {
  const order = new OrderEnvelope(
    [new OrderLine('a', 'A', 'o', 'i', 1000, 1)],
    new Buyer('Ada', 'Lovelace', 'ada@example.com', '5551234567', '1 Main St', 'Metropolis', 'NY', '10001'),
    1000, 0, 1000, 'USD', null, {}, null, null, null, 'idem-1', 'a',
  ); // prettier-ignore

  async function recordedLastFour(credential: PaymentCredential, providerLastFour: string | null): Promise<unknown> {
    const insert = jest.fn().mockResolvedValue(1);
    const recorder = new DatabaseOrderRecorder({ insert } as never, capturedLog().log);
    const outcome = PlacementOutcome.placed('pi_1', 'succeeded', null, null, SettlementMode.Capture, null, 'visa', '12/34', providerLastFour);

    await recorder.record(order, outcome, credential, [], 'stripe');

    return insert.mock.calls[0][0].card_last_four;
  }

  it("takes a Stripe token's last four from the provider", async () => {
    expect(await recordedLastFour(PaymentCredential.token('ctoken_1'), '4242')).toBe('4242');
  });

  it('prefers the number the buyer typed', async () => {
    expect(await recordedLastFour(PaymentCredential.card('4111111111111234', '12', '2030', '123'), '9999')).toBe('1234');
  });

  it('records null when neither has one', async () => {
    expect(await recordedLastFour(PaymentCredential.token('ctoken_1'), null)).toBeNull();
  });
});
