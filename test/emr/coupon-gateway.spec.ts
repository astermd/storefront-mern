import { ApiError, NotFoundError } from '@astermd-hq/sdk';
import { EmrClientFactory } from '../../src/emr/client-factory';
import { EmrCouponGateway } from '../../src/emr/emr-coupon-gateway';
import { NullCouponGateway } from '../../src/emr/null-coupon-gateway';
import { OrderLine } from '../../src/payment/order-line';
import { capturedLog, response } from '../support/fake-emr-client';

/**
 * Coupon gateway coverage, after the cases storefront-lamp exercises through its Stripe adapter
 * tests: the EMR's `POST /coupons/validate` answers {discount_cents, coupon_id}, 404 for an unknown
 * code and 422 with a buyer-facing message for every other refusal. The installed SDK has no
 * coupons resource yet, so the client here is a stand-in exposing one.
 */
const line = () => new OrderLine('slug', 'Name', 'o', 'i', 1000, 2, 'otc', 'p1', 'v1', null);

function gateway(coupons: Record<string, jest.Mock> | null) {
  const captured = capturedLog();
  const client = coupons === null ? {} : { coupons: () => coupons };
  const clients = { create: () => client } as unknown as EmrClientFactory;

  return { gateway: new EmrCouponGateway(clients, captured.log), captured };
}

describe('EmrCouponGateway', () => {
  it('is unavailable when the installed SDK has no coupons resource, and refuses quietly', async () => {
    const { gateway: g } = gateway(null);

    expect(g.available()).toBe(false);
    const quote = await g.quote('SAVE10', [line()]);
    expect(quote.accepted).toBe(false);
    expect(quote.reason).toBe('unsupported');
  });

  it('prices a code, naming lines by EMR product and variant, and carries the coupon id as reference', async () => {
    const validate = jest.fn().mockResolvedValue(response({ discount_cents: 250, coupon_id: 'c_1' }));
    const { gateway: g } = gateway({ validate });

    expect(g.available()).toBe(true);
    const quote = await g.quote(' SAVE10 ', [line()]);

    expect(validate).toHaveBeenCalledWith('SAVE10', [{ product_id: 'p1', variant_id: 'v1', quantity: 2 }]);
    expect(quote.accepted).toBe(true);
    expect(quote.discountCents).toBe(250);
    expect(quote.reference).toBe('c_1');
  });

  it('names a line sold on a plan by the plan alone', async () => {
    const validate = jest.fn().mockResolvedValue(response({ discount_cents: 100, coupon_id: 'c_1' }));
    const { gateway: g } = gateway({ validate });

    await g.quote('X', [new OrderLine('s', 'n', 'o', 'i', 1000, 1, 'otc', 'p1', 'v1', 'plan_9')]);

    expect(validate).toHaveBeenCalledWith('X', [{ plan_id: 'plan_9', quantity: 1 }]);
  });

  it('refuses without calling the EMR when a line has no EMR ids, or the code or cart is empty', async () => {
    const validate = jest.fn();
    const { gateway: g } = gateway({ validate });

    expect((await g.quote('X', [new OrderLine('s', 'n', 'o', 'i', 1000, 1)])).reason).toBe('unsupported');
    expect((await g.quote('  ', [line()])).reason).toBe('unsupported');
    expect((await g.quote('X', [])).reason).toBe('unsupported');
    expect(validate).not.toHaveBeenCalled();
  });

  it('a 404 is an unknown code with a fixed notice', async () => {
    const { gateway: g } = gateway({ validate: jest.fn().mockRejectedValue(new NotFoundError('nope', 404, {})) });

    const quote = await g.quote('NOPE', [line()]);
    expect(quote.reason).toBe('unknown_code');
    expect(quote.notice).toBe("That discount code isn't valid.");
  });

  it('a 422 is shown with the EMR\'s own buyer-facing message', async () => {
    const { gateway: g } = gateway({ validate: jest.fn().mockRejectedValue(new ApiError('x', 422, { message: 'This code has expired.' })) });

    const quote = await g.quote('OLD', [line()]);
    expect(quote.reason).toBe('denied');
    expect(quote.notice).toBe('This code has expired.');
  });

  it('any other failure is unavailable, with no notice and no message in the log', async () => {
    const { gateway: g, captured } = gateway({ validate: jest.fn().mockRejectedValue(new ApiError('free text 4111', 500, {})) });

    const quote = await g.quote('X', [line()]);
    expect(quote.reason).toBe('unavailable');
    expect(quote.notice).toBeNull();
    expect(JSON.stringify(captured.lines)).not.toContain('free text');
    expect(captured.lines[0]).toMatchObject({ event: 'coupon.unavailable', context: { status: 500 } });
  });

  it('an unreadable answer is rejected and logged', async () => {
    const { gateway: g, captured } = gateway({ validate: jest.fn().mockResolvedValue(response({ discount_cents: '5' })) });

    expect((await g.quote('X', [line()])).reason).toBe('unreadable');
    expect(captured.lines[0].event).toBe('coupon.unreadable_quote');
  });
});

describe('NullCouponGateway', () => {
  it('is unavailable and rejects every code as unsupported', async () => {
    const g = new NullCouponGateway();

    expect(g.available()).toBe(false);
    expect((await g.quote('X', [line()])).reason).toBe('unsupported');
  });
});
