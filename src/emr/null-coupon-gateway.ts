import { OrderLine } from '../payment/order-line';
import { PromotionQuote } from '../payment/promotion-quote';
import { CouponGateway } from './coupon-gateway';

/**
 * Ported from storefront-lamp/core/Emr/NullCouponGateway.php. No coupons: bound under the test
 * suite, so no run reaches the EMR, and the answer a provider that depends on this gives when it
 * cannot price codes.
 *
 * Unavailable rather than refusing each code, so the promo control is hidden instead of shown and
 * then refused (`[13.18]`).
 */
export class NullCouponGateway implements CouponGateway {
  async quote(code: string, _lines: OrderLine[]): Promise<PromotionQuote> {
    return PromotionQuote.rejected(code, 'unsupported');
  }

  available(): boolean {
    return false;
  }
}
