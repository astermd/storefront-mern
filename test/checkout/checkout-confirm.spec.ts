import { CheckoutService } from '../../src/checkout/checkout.service';
import { BuyerDetails } from '../../src/checkout/buyer-details';
import { PostChargeGuard } from '../../src/checkout/post-charge-guard';
import { Cart } from '../../src/domain/cart';
import { CartLine } from '../../src/domain/cart-line';
import { CartOutcome } from '../../src/domain/cart-outcome';
import { JourneyState } from '../../src/journey/journey-state';
import { AdapterCapabilities, SCOPE_ORDER_LEVEL, STRATEGY_TOKENIZATION, SURFACE_PROVIDER_HOSTED, SURFACE_THEME_FIELDS } from '../../src/payment/adapter-capabilities';
import { CaptureOutcome } from '../../src/payment/capture-outcome';
import { OrderEnvelope } from '../../src/payment/order-envelope';
import { OrderSearchResult } from '../../src/payment/order-search-result';
import { PaymentAdapter } from '../../src/payment/payment-adapter';
import { PaymentCredential } from '../../src/payment/payment-credential';
import { PlacementOutcome } from '../../src/payment/placement-outcome';
import { PromotionQuote } from '../../src/payment/promotion-quote';
import { SettlementMode } from '../../src/payment/settlement-mode';
import { CheckoutAttempt } from '../../src/checkout/checkout-attempt';

/**
 * The generic bank-verification round trip (`[14.22]`) in `CheckoutService`, driven against test
 * doubles — no database. Covers the adapter that declares `supportsClientAction`, and (the
 * regression that matters) one that declares it false, which must keep stopping the checkout exactly
 * as Vrio and CheckoutChamp always have.
 */

const REFERENCE = 'pi_challenge';
const CLIENT_ACTION = 'pi_challenge_secret_never_stored';

class ChallengingAdapter implements PaymentAdapter {
  placements = 0;
  private readonly resumes: PlacementOutcome[] = [];

  constructor(private readonly clientAction: boolean) {}

  willResumeAs(outcome: PlacementOutcome): void {
    this.resumes.push(outcome);
  }

  capabilities(): AdapterCapabilities {
    return new AdapterCapabilities('challenging', false, SCOPE_ORDER_LEVEL, STRATEGY_TOKENIZATION, this.clientAction ? SURFACE_PROVIDER_HOSTED : SURFACE_THEME_FIELDS, [], [], 'Test double.', false, false, false, false, [], {}, this.clientAction);
  }

  async place(_order: OrderEnvelope, _credential: PaymentCredential): Promise<PlacementOutcome> {
    this.placements += 1;
    return PlacementOutcome.pendingAction(REFERENCE, '', 'requires_action', CLIENT_ACTION);
  }

  async resume(reference: string): Promise<PlacementOutcome> {
    return this.resumes.shift() ?? PlacementOutcome.pendingAction(reference, '', 'requires_action', CLIENT_ACTION);
  }

  async quotePromotion(_order: OrderEnvelope, code: string): Promise<PromotionQuote> {
    return PromotionQuote.rejected(code, 'unsupported');
  }

  async searchOrders(): Promise<OrderSearchResult> {
    return OrderSearchResult.unsupported();
  }

  async capture(): Promise<CaptureOutcome> {
    return CaptureOutcome.unsupported();
  }

  async ping(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: 'test' };
  }
}

class FakeAttempts {
  rows = new Map<string, { state: string; outcome: Record<string, unknown> | null; createdAt: string }>();

  async claim(key: string, _session: string, now: string): Promise<boolean> {
    if (this.rows.has(key)) return false;
    this.rows.set(key, { state: 'claimed', outcome: null, createdAt: now });
    return true;
  }

  async markSent(key: string): Promise<void> {
    this.rows.get(key)!.state = 'sent';
  }

  async recordOutcome(key: string, outcome: Record<string, unknown>): Promise<void> {
    Object.assign(this.rows.get(key)!, { state: 'complete', outcome });
  }

  async resolvePending(key: string, claimedAt: string, outcome: Record<string, unknown>): Promise<void> {
    const row = this.rows.get(key);
    if (row !== undefined && row.createdAt === claimedAt) row.outcome = outcome;
  }

  async release(key: string): Promise<void> {
    this.rows.delete(key);
  }

  async outcomeFor(key: string): Promise<{ key: string; sessionKey: string; state: string; outcome: Record<string, unknown> | null; createdAt: string; completedAt: string | null } | null> {
    const row = this.rows.get(key);
    return row === undefined ? null : { key, sessionKey: 's', state: row.state, outcome: row.outcome, createdAt: row.createdAt, completedAt: null };
  }
}

function harness(adapter: PaymentAdapter) {
  const cart = new Cart();
  cart.put(new CartLine('item', 'Item', 'otc', null, null, 1, 5000, null));
  const state = new JourneyState();
  const attempts = new FakeAttempts();
  const saved: Cart[] = [];
  const log = { info: jest.fn(), warning: jest.fn(), error: jest.fn() };

  const service = new CheckoutService(
    { get: () => ({ currentCart: () => cart, save: (c: Cart) => saved.push(c) }) } as never,
    { get: () => ({ currentState: () => state, sessionUuid: () => 'sess-1' }) } as never,
    { applyTerritory: () => CartOutcome.accepted() } as never,
    { product: () => ({ slug: 'item', variants: [{ id: 'v1', name: 'V1', price_cents: 5000, provider: { offer_id: 'o1', product_id: 'p1' } }] }) } as never,
    adapter,
    { record: () => ({ records: [], missing: [] }), definitions: () => [] } as never,
    { offeredFor: () => [] } as never,
    { isEnabled: () => false } as never,
    attempts as never,
    { allow: async () => true } as never,
    { record: async () => undefined } as never,
    { checkoutVisited: async () => undefined, orderPlaced: async () => undefined, orderDeclined: async () => undefined } as never,
    {} as never,
    { pathFor: (step: string) => `/${step}/`, allSteps: () => ({ upsell: {}, receipt: {} }) } as never,
    { get: (_key: string, fallback: unknown) => fallback } as never,
    log as never,
    new PostChargeGuard(log as never),
    { queueFor: () => [] } as never,
    { forSlugs: () => SettlementMode.Capture } as never,
    { sessionID: 'http-session' } as never,
  );

  return { service, cart, state, attempts, saved, log };
}

const buyer = () => new BuyerDetails({ firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', phone: '5551234567', addressLine: '1 Main St', city: 'Town', territory: 'NY', postalCode: '10001' });
const token = () => PaymentCredential.token('ctoken_1');

describe('CheckoutService bank-verification round trip', () => {
  it('keeps a challenge pending and sends the buyer to the confirm step when the adapter declares supportsClientAction', async () => {
    const adapter = new ChallengingAdapter(true);
    const { service, cart, state, attempts } = harness(adapter);

    const result = await service.submit(buyer(), token(), {});

    expect(result.outcome.isPlaced()).toBe(false);
    expect(result.redirectTo).toBe(CheckoutService.CONFIRM_PATH);
    expect(CheckoutService.CONFIRM_PATH).toBe('/checkout/confirm/');
    expect(cart.isEmpty()).toBe(false);
    expect(state.pendingPayment?.reference).toBe(REFERENCE);
    expect(service.hasPendingPayment()).toBe(true);

    // Neither the stored attempt nor the journey state ever carries the client action.
    expect(JSON.stringify([...attempts.rows.values()])).not.toContain(CLIENT_ACTION);
    expect(JSON.stringify(state.toArray())).not.toContain(CLIENT_ACTION);
  });

  it('renders the challenge while the bank is still deciding', async () => {
    const { service } = harness(new ChallengingAdapter(true));
    await service.submit(buyer(), token(), {});

    const result = await service.resume();

    expect(result.redirectTo).toBeNull();
    expect(result.paymentChallenge).toBe(CLIENT_ACTION);
    expect(result.notice).toBe(CheckoutService.VERIFY_NOTICE);
    expect(service.hasPendingPayment()).toBe(true);
  });

  it('finishes a verified payment as a placed order and replays the placement to a duplicate', async () => {
    const adapter = new ChallengingAdapter(true);
    const { service, saved, state, attempts } = harness(adapter);
    await service.submit(buyer(), token(), {});
    adapter.willResumeAs(PlacementOutcome.placed(REFERENCE, 'succeeded'));

    const result = await service.resume();

    expect(result.outcome.isPlaced()).toBe(true);
    expect(result.redirectTo).toBe('/upsell/');
    expect(saved[saved.length - 1].isEmpty()).toBe(true);
    expect(state.placedOrders).toEqual([REFERENCE]);
    expect(service.hasPendingPayment()).toBe(false);
    expect(adapter.placements).toBe(1);

    const stored = [...attempts.rows.values()][0].outcome as Record<string, unknown>;
    expect(CheckoutAttempt.decodeOutcome(stored)?.isPlaced()).toBe(true);
  });

  it('releases the key and keeps the cart when verification fails', async () => {
    const adapter = new ChallengingAdapter(true);
    const { service, cart, attempts } = harness(adapter);
    await service.submit(buyer(), token(), {});
    adapter.willResumeAs(PlacementOutcome.declined(REFERENCE, 'Authentication failed.', 'requires_payment_method'));

    const result = await service.resume();

    expect(result.outcome.isPlaced()).toBe(false);
    expect(result.notice).toBe(CheckoutService.VERIFICATION_FAILED_NOTICE);
    expect(cart.isEmpty()).toBe(false);
    expect(service.hasPendingPayment()).toBe(false);
    expect(attempts.rows.size).toBe(0);
  });

  it('refuses sub-actions and sends a repeat submit back to confirm while a payment is pending', async () => {
    const adapter = new ChallengingAdapter(true);
    const { service } = harness(adapter);
    await service.submit(buyer(), token(), {});

    expect(service.choosePlan('x', 'y').accepted).toBe(false);
    expect((await service.toggleBump('x')).accepted).toBe(false);
    expect((await service.applyPromotion('')).accepted).toBe(true); // nothing to apply, nothing to say

    const again = await service.submit(buyer(), token(), {});
    expect(again.redirectTo).toBe(CheckoutService.CONFIRM_PATH);
    expect(adapter.placements).toBe(1);
  });

  it('sends the buyer back to checkout when the confirm step has nothing pending', async () => {
    const { service } = harness(new ChallengingAdapter(true));

    const result = await service.resume();

    expect(result.redirectTo).toBe('/checkout/');
  });

  it('keeps stopping the checkout for an adapter that declares no client action', async () => {
    const adapter = new ChallengingAdapter(false);
    const { service, cart, state } = harness(adapter);

    const result = await service.submit(buyer(), token(), {});

    expect(result.outcome.state).toBe(PlacementOutcome.PENDING_ACTION);
    expect(result.redirectTo).toBeNull();
    expect(result.notice).toBe(CheckoutService.PENDING_ACTION_NOTICE.replace('%s', REFERENCE));
    expect(cart.isEmpty()).toBe(false);
    expect(state.pendingPayment).toBeNull();
    expect(service.hasPendingPayment()).toBe(false);
  });
});
