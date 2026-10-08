import { OrderEnvelope } from '../order-envelope';
import { PaymentCredential } from '../payment-credential';
import { SettlementMode } from '../settlement-mode';
import { CardScheme } from './card-scheme';
import { VrioAttribution } from './vrio-attribution';
import { VrioCredentials } from './vrio-credentials';
import { VrioOffers } from './vrio-offers';

/**
 * Ported from storefront-lamp/core/Payment/Vrio/VrioPayload.php. Builds the `POST /orders` body,
 * and the payment block `place()` uses to short-circuit before the wire when a credential this
 * provider cannot charge is handed to it.
 */
export class VrioPayload {
  private static readonly PAYMENT_METHOD_CARD = 1;

  static forOrder(order: OrderEnvelope, credential: PaymentCredential, credentials: VrioCredentials, shippingProfileId: number): Record<string, unknown> {
    const buyer = order.buyer;
    const [attributionSlots] = VrioAttribution.map(order.attribution as Record<string, unknown>);

    const body: Record<string, unknown> = {
      campaign_id: credentials.campaignId,
      connection_id: credentials.connectionId,
      force_campaign_id: true,
      offers_restrict: true,
      shipping_profile_id: shippingProfileId,
      action: SettlementMode.isAuthorize(order.settlement) ? 'authorize' : 'process',
      email: buyer.email,
      phone: buyer.phone,
      ship_fname: buyer.firstName,
      ship_lname: buyer.lastName,
      ship_address1: buyer.addressLine,
      ship_city: buyer.city,
      ship_state: buyer.territory,
      ship_zipcode: buyer.postalCode,
      ship_country: buyer.country,
      shipping_same: true,
      bill_fname: buyer.firstName,
      bill_lname: buyer.lastName,
      bill_address1: buyer.addressLine,
      bill_city: buyer.city,
      bill_state: buyer.territory,
      bill_zipcode: buyer.postalCode,
      bill_country: buyer.country,
      offers: VrioOffers.forCharge(order),
      ip_address: order.clientIp ?? '',
      user_agent: order.userAgent ?? '',
      ...attributionSlots,
      ...VrioPayload.paymentFor(credential),
    };

    if (order.sessionUuid !== null && order.sessionUuid !== '') {
      body.session_id = order.sessionUuid;
    }

    return body;
  }

  /** `{}` (empty) when the provider cannot charge against this credential kind — the caller short-circuits before the wire. */
  static paymentFor(credential: PaymentCredential): Record<string, unknown> {
    if (credential.kind === PaymentCredential.KIND_CARD) {
      return {
        payment_method_id: VrioPayload.PAYMENT_METHOD_CARD,
        card_type_id: CardScheme.codeFor(credential.number ?? ''),
        card_number: credential.number ?? '',
        card_exp_month: credential.expiryMonth ?? '',
        card_exp_year: credential.expiryYear ?? '',
        card_cvv: credential.securityCode ?? '',
      };
    }

    if (credential.kind === PaymentCredential.KIND_STORED_INSTRUMENT) {
      const customerId = credential.handle?.customer_id ?? '';
      const cardId = credential.handle?.customer_card_id ?? '';
      if (customerId === '' || cardId === '') return {};

      return { payment_method_id: VrioPayload.PAYMENT_METHOD_CARD, customer_id: customerId, customer_card_id: cardId };
    }

    return {};
  }
}
