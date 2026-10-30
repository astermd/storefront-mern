import { Buyer } from '../buyer';
import { OrderEnvelope } from '../order-envelope';
import { OrderLine } from '../order-line';
import { PaymentCredential } from '../payment-credential';
import { SettlementMode, SettlementModeValue } from '../settlement-mode';

type Body = Record<string, unknown>;

interface Shipping {
  name: string;
  phone?: string;
  address: Record<string, string>;
}

/**
 * Ported from storefront-lamp/core/Payment/Stripe/StripePayload.php. The PaymentIntent this
 * storefront creates for an order, in the shape the EMR reads back when the order is synced.
 *
 * **The EMR is the reader that matters, not Stripe.** Stripe only needs an amount. The EMR turns the
 * PaymentIntent into a treatment: it reads each `amount_details` line item for what was bought and
 * at what price, matches it by index to the `astermd_line_items` metadata entry for the EMR's own
 * ids, reads `astermd_order_type` to decide whether the order renews, checks `astermd_session_id`
 * against the session it is synced under, and keeps the customer and card for renewals. Every key
 * here is that contract (`docs/stripe-integration.md` in the sales service); a key it does not know
 * is ignored, and one it reserves for its own renewals must never be set.
 *
 * **A line sold on a plan is named by the plan alone** — `{"plan_id"}` with no product or variant —
 * and makes the order a `cycle`: the EMR takes the product and variant from the plan and renews on
 * it. Every other line is `{"product_id", "variant_id"}`, the variant being the product's own id for
 * a product without variants, and an order with no plan line is a `straight_sale`.
 *
 * **Holding funds is narrower here than the deployment's setting.** The EMR captures a held payment
 * when a doctor completes the case it opens for a prescription, so a hold on a cart with no
 * prescription is one nothing would ever capture, and a hold on an upsell is one the EMR never
 * captures automatically. Both are charged at once instead, and the outcome says so
 * (`settlementFor()`).
 */
export class StripePayload {
  /** Stripe's limit on one metadata value, which bounds how many lines one order can name. */
  static readonly METADATA_VALUE_MAX_LENGTH = 500;

  /** Stripe's limit on a line item's name. */
  private static readonly LINE_ITEM_NAME_MAX_LENGTH = 1024;

  /** The kind the catalog gives a prescription line. */
  private static readonly PRESCRIPTION = 'rx';

  /** Canonical attribution key → the metadata key the EMR reads it from. */
  private static readonly ATTRIBUTION: Record<string, string> = {
    affiliate_id: 'astermd_aff',
    c1: 'astermd_c1',
    c2: 'astermd_c2',
    c3: 'astermd_c3',
    c4: 'astermd_c4',
    c5: 'astermd_c5',
    utm_source: 'astermd_utm_source',
    utm_medium: 'astermd_utm_medium',
    utm_campaign: 'astermd_utm_campaign',
  };

  /** An EMR (DocumentDB) ObjectId: what the EMR refuses anything else for. */
  private static readonly OBJECT_ID = /^[a-f\d]{24}$/i;

  /**
   * What this order may do with the money, given what was asked.
   *
   * Authorize only when asked to, only for a cart with a prescription line, and never for a
   * follow-on order — see the class doc for why each of the other cases would be a hold nobody
   * captures.
   */
  static settlementFor(order: OrderEnvelope): SettlementModeValue {
    if (!SettlementMode.isAuthorize(order.settlement) || order.followOn) {
      return SettlementMode.Capture;
    }

    return order.lines.some((line) => line.kind === StripePayload.PRESCRIPTION) ? SettlementMode.Authorize : SettlementMode.Capture;
  }

  /**
   * How the credential pays, or an empty object when this provider cannot charge it — which the
   * adapter refuses before anything is sent.
   *
   * A token is what Stripe's own fields minted on the page (a confirmation token), confirmed here
   * with the buyer present. A stored instrument is the customer and card an earlier payment on the
   * journey saved, charged with the buyer no longer entering anything. A card is never charged here:
   * this storefront does not collect one for this provider.
   */
  static paymentFor(credential: PaymentCredential): Body {
    if (credential.kind === PaymentCredential.KIND_TOKEN && credential.reference !== null && credential.reference !== '') {
      return { confirmation_token: credential.reference };
    }

    if (credential.isReusable()) {
      const customer = credential.handle?.customer ?? '';
      const method = credential.handle?.payment_method ?? '';

      if (customer !== '' && method !== '') {
        return { customer, payment_method: method, off_session: true };
      }
    }

    return {};
  }

  /**
   * The `astermd_line_items` value, or null when a line cannot be named the way the EMR names it —
   * an order the EMR cannot map is refused rather than sent with a gap in it.
   */
  static lineItemsMetadata(order: OrderEnvelope): string | null {
    const entries: Record<string, string>[] = [];

    for (const line of order.lines) {
      const entry = StripePayload.lineEntry(line);
      if (entry === null) return null;

      entries.push(entry);
    }

    return entries.length === 0 ? null : JSON.stringify(entries);
  }

  /** Whether any line is sold on a plan, which is what makes the order renew. */
  static orderType(order: OrderEnvelope): string {
    return order.lines.some((line) => line.planId !== null) ? 'cycle' : 'straight_sale';
  }

  /**
   * The PaymentIntent for an order, confirmed in the same call.
   *
   * @param payment from `paymentFor()`
   */
  static forOrder(order: OrderEnvelope, payment: Body, customerId: string, lineItems: string, settlement: SettlementModeValue, channelId: string, returnUrl: string): Body {
    const offSession = payment.off_session === true;

    const body: Body = {
      amount: order.totalCents,
      currency: order.currency.toLowerCase(),
      customer: customerId,
      confirm: true,
      // Cards only: the EMR saves a card for renewals and reads its descriptor, and a method that
      // redirects to a third party is one this checkout has no page to come back to except the
      // confirm step. Stripe only confirms a token with the same kind of list the page's Elements
      // collected it under, so this must stay in step with `allowedPaymentMethodTypes` in
      // `public/js/payment-stripe.js`.
      allowed_payment_method_types: ['card'],
      capture_method: SettlementMode.isAuthorize(settlement) ? 'manual' : 'automatic',
      amount_details: StripePayload.amountDetails(order),
      metadata: StripePayload.metadata(order, lineItems, settlement, channelId),
      expand: ['payment_method'],
      ...payment,
    };

    if (!offSession) {
      // The card is saved for the renewals the EMR charges and for an upsell on this journey, and
      // the page's Elements were set up the same way — the two must agree or Stripe refuses the
      // token.
      body.setup_future_usage = 'off_session';
      // Any verification the bank asks for is run on the page by Stripe's script, or by redirect
      // back to the confirm step.
      body.use_stripe_sdk = true;
      body.return_url = returnUrl;
    }

    const shipping = StripePayload.shipping(order.buyer);
    if (shipping !== null) {
      body.shipping = shipping;
    }

    return body;
  }

  /** The Stripe Customer an order's card is saved to. */
  static forCustomer(buyer: Buyer): Body {
    const body: Body = { email: buyer.email };

    const name = StripePayload.fullName(buyer);
    if (name !== '') body.name = name;

    if (buyer.phone !== '') body.phone = buyer.phone;

    const shipping = StripePayload.shipping(buyer);
    if (shipping !== null) {
      body.address = shipping.address;
      body.shipping = shipping;
    }

    return body;
  }

  /** Canonical attribution keys the EMR has no slot for, so the adapter can say what it dropped (`[14.7]`). */
  static droppedAttribution(attribution: Record<string, unknown>): string[] {
    return Object.entries(attribution)
      .filter(([key, value]) => String(value ?? '').trim() !== '' && StripePayload.ATTRIBUTION[key] === undefined)
      .map(([key]) => key);
  }

  private static lineEntry(line: OrderLine): Record<string, string> | null {
    if (line.planId !== null) {
      return StripePayload.OBJECT_ID.test(line.planId) ? { plan_id: line.planId } : null;
    }

    if (
      line.emrProductId === null ||
      line.emrVariantId === null ||
      !StripePayload.OBJECT_ID.test(line.emrProductId) ||
      !StripePayload.OBJECT_ID.test(line.emrVariantId)
    ) {
      return null;
    }

    return { product_id: line.emrProductId, variant_id: line.emrVariantId };
  }

  /**
   * One line item per order line, in the order `astermd_line_items` names them — the EMR pairs the
   * two by index. Stripe checks the items less the discount add up to the amount, so every line
   * goes, free ones included.
   */
  private static amountDetails(order: OrderEnvelope): Body {
    const items = order.lines.map((line) => ({
      product_name: Array.from(line.name !== '' ? line.name : 'Item')
        .slice(0, StripePayload.LINE_ITEM_NAME_MAX_LENGTH)
        .join(''),
      unit_cost: line.unitPriceCents,
      quantity: line.quantity,
    }));

    const details: Body = { line_items: items };
    if (order.discountCents > 0) details.discount_amount = order.discountCents;

    return details;
  }

  private static metadata(order: OrderEnvelope, lineItems: string, settlement: SettlementModeValue, channelId: string): Record<string, string> {
    const metadata: Record<string, string> = {
      astermd_line_items: lineItems,
      astermd_order_type: StripePayload.orderType(order),
      // Informational: how the payment settles and which code the buyer typed, readable on the
      // payment in Stripe without asking the EMR.
      capture_method: SettlementMode.isAuthorize(settlement) ? 'manual' : 'automatic',
    };

    if (SettlementMode.isAuthorize(settlement)) metadata.astermd_payment_mode = 'pre_auth';

    if (order.sessionUuid !== null && order.sessionUuid !== '') metadata.astermd_session_id = order.sessionUuid;

    if (order.promotionCode !== null && order.promotionCode !== '') metadata.coupon = order.promotionCode;

    if (order.promotionReference !== null && StripePayload.OBJECT_ID.test(order.promotionReference)) {
      metadata.astermd_coupon_id = order.promotionReference;
    }

    if (order.followOn) metadata.astermd_upsell = '1';

    for (const [key, raw] of Object.entries(order.attribution)) {
      const slot = StripePayload.ATTRIBUTION[key];
      const value = String(raw ?? '').trim();

      if (slot !== undefined && value !== '') {
        metadata[slot] = Array.from(value).slice(0, StripePayload.METADATA_VALUE_MAX_LENGTH).join('');
      }
    }

    // Which storefront channel created the payment, so the reverse sweep can tell this channel's
    // payments from another's on a shared account.
    if (channelId !== '') metadata.storefront_channel_id = channelId;

    return metadata;
  }

  private static shipping(buyer: Buyer): Shipping | null {
    if (buyer.addressLine === '') return null;

    const shipping: Shipping = {
      name: StripePayload.fullName(buyer),
      address: {
        line1: buyer.addressLine,
        city: buyer.city,
        state: buyer.territory,
        postal_code: buyer.postalCode,
        country: buyer.country,
      },
    };

    if (buyer.phone !== '') shipping.phone = buyer.phone;

    return shipping;
  }

  private static fullName(buyer: Buyer): string {
    return `${buyer.firstName} ${buyer.lastName}`.trim();
  }
}
