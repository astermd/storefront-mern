import { Totals } from '../../checkout/totals';
import { OrderEnvelope } from '../order-envelope';
import { OrderLine } from '../order-line';

/**
 * Ported from storefront-lamp/core/Payment/Vrio/VrioOffers.php. One shared line-builder for both
 * `calculateDiscount` (quote) and `addOrder` (charge) — deliberately a single builder, because two
 * independent ones once drifted apart (a quote priced every line while a charge only priced the
 * first, an overcharge). The ONE difference between the two call sites is the quantity field's key
 * name.
 */
export class VrioOffers {
  static forCharge(order: OrderEnvelope): Record<string, unknown>[] {
    const code = String(order.promotionCode ?? '');
    return order.chargeableLines().map((line) => ({
      ...VrioOffers.line(line, 'order_offer_quantity', code),
      order_offer_shipping: '0.00',
      order_offer_upsell: false,
      parent_offer_id: null,
      parent_order_id: null,
    }));
  }

  static forQuote(order: OrderEnvelope, code: string): Record<string, unknown>[] {
    return order.chargeableLines().map((line) => VrioOffers.line(line, 'offer_quantity', code));
  }

  private static line(line: OrderLine, quantityKey: string, code: string): Record<string, unknown> {
    return {
      offer_id: String(line.providerOffer),
      item_id: String(line.providerItem),
      order_offer_price: Totals.decimalString(line.unitPriceCents),
      [quantityKey]: String(line.quantity),
      discount_code: code,
    };
  }
}
