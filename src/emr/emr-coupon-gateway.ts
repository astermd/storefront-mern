import { ApiError, NotFoundError } from '@astermd-hq/sdk';
import type { CouponCartItem } from '@astermd-hq/sdk';
import { OrderLine } from '../payment/order-line';
import { PromotionQuote } from '../payment/promotion-quote';
import { OperatorLog } from '../support/operator-log';
import { EmrClientFactory } from './client-factory';
import { CouponGateway } from './coupon-gateway';

/** The slice of the SDK's coupons resource this gateway uses (`@astermd-hq/sdk` 0.0.4 ships it). */
interface CouponsResource {
  validate(options: { code: string; items: CouponCartItem[]; email?: string }): Promise<{ data(): unknown }>;
}

/**
 * Ported from storefront-lamp/core/Emr/EmrCouponGateway.php. {@link CouponGateway} over the EMR's
 * `POST /coupons/validate`.
 *
 * Each line is named the way the EMR's order will name it — by the plan it is sold on, or by the
 * EMR's product and variant — and never by an amount: the EMR prices the cart from its own
 * catalogue, which is why the discount it answers is the one it will honour when the order is read
 * back.
 *
 * **The buyer is named by email when the checkout holds one**, so a coupon restricted to particular
 * patients can match them. Without a well-formed one the field is left out rather than sent empty or
 * malformed (a malformed email is a 400 for the whole request), and only a coupon open to anyone applies.
 *
 * **Nothing is counted.** The EMR checks the code and answers what it would take off; the
 * redemption is recorded when the paid order reaches it.
 *
 * **Its refusals are shown as they are written.** A 404 is an unknown code. A 422 is every other
 * reason — expired, used up, not for this product, a plan whose first payment takes no coupons —
 * and the EMR's message for it is written for the buyer, so it is their notice. Anything else is the
 * EMR being unreachable, which is a code that did not apply this time rather than an error page
 * (`[13.14]`), and its message is not shown or logged: it is the EMR's own free text (`[20.6]`).
 *
 * **Unavailable until the SDK this deployment runs offers the coupons resource** (`client.coupons()`,
 * by the naming of every other resource), so a storefront on an older SDK hides the control rather
 * than refusing every code typed into it. `@astermd-hq/sdk` 0.0.4 is the first to ship it; the
 * resource is still reached through a defensive cast so a deployment on an older SDK degrades to
 * "unavailable" instead of throwing.
 */
export class EmrCouponGateway implements CouponGateway {
  private static readonly UNKNOWN_CODE = "That discount code isn't valid.";

  constructor(
    private readonly clients: EmrClientFactory,
    private readonly log: OperatorLog,
  ) {}

  async quote(code: string, lines: OrderLine[], email: string | null = null): Promise<PromotionQuote> {
    code = code.trim();
    const buyer = EmrCouponGateway.email(email);
    const items = EmrCouponGateway.items(lines);

    if (code === '' || items === null) {
      return PromotionQuote.rejected(code, 'unsupported');
    }

    let data: Record<string, unknown>;
    try {
      const coupons = this.resource();
      if (coupons === null) {
        return PromotionQuote.rejected(code, 'unsupported');
      }
      const result = (await coupons.validate({ code, items, ...(buyer === null ? {} : { email: buyer }) })).data();
      data = result !== null && typeof result === 'object' ? (result as Record<string, unknown>) : {};
    } catch (e) {
      if (e instanceof NotFoundError) {
        return PromotionQuote.rejected(code, 'unknown_code', EmrCouponGateway.UNKNOWN_CODE);
      }

      if (e instanceof ApiError && e.statusCode() === 422) {
        const message = e.envelope().message;

        return PromotionQuote.rejected(code, 'denied', typeof message === 'string' && message !== '' ? message : null);
      }

      this.unavailable(e);

      return PromotionQuote.rejected(code, 'unavailable');
    }

    const discount = data.discount_cents;
    const couponId = data.coupon_id;

    if (typeof discount !== 'number' || !Number.isInteger(discount) || typeof couponId !== 'string' || couponId === '') {
      this.log.warning('coupon.unreadable_quote', { code });

      return PromotionQuote.rejected(code, 'unreadable');
    }

    return PromotionQuote.accepted(code, discount, couponId);
  }

  available(): boolean {
    try {
      return this.resource() !== null;
    } catch {
      // No EMR credentials: nothing to price codes with.
      return false;
    }
  }

  /** The client's coupons resource, or null when the installed SDK has none. */
  private resource(): CouponsResource | null {
    const client = this.clients.create() as unknown as { coupons?: () => CouponsResource };

    return typeof client.coupons === 'function' ? client.coupons() : null;
  }

  /**
   * The lines as the EMR names them, or null when one cannot be named: a code priced against part of
   * the cart is a discount on some other cart.
   */
  private static items(lines: OrderLine[]): CouponCartItem[] | null {
    const items: CouponCartItem[] = [];

    for (const line of lines) {
      if (line.planId !== null) {
        items.push({ plan_id: line.planId, quantity: line.quantity });
        continue;
      }

      if (line.emrProductId === null || line.emrVariantId === null) {
        return null;
      }

      items.push({ product_id: line.emrProductId, variant_id: line.emrVariantId, quantity: line.quantity });
    }

    return items.length === 0 ? null : items;
  }

  /** A trimmed, well-formed email, or null: the EMR refuses the whole request over a malformed one. */
  private static email(email: string | null): string | null {
    const trimmed = (email ?? '').trim();

    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
  }

  private unavailable(e: unknown): void {
    this.log.info('coupon.unavailable', {
      exception: (e as Error)?.constructor?.name ?? 'unknown',
      status: e instanceof ApiError ? e.statusCode() : null,
    });
  }
}
