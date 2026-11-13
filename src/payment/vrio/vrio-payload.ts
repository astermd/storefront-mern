import { OrderEnvelope } from '../order-envelope';
import { PaymentCredential } from '../payment-credential';
import { SettlementMode } from '../settlement-mode';
import { CardScheme } from './card-scheme';
import { VrioAttribution } from './vrio-attribution';
import { VrioCredentials } from './vrio-credentials';
import { VrioOffers } from './vrio-offers';

/**
 * Builds the `POST /orders` body,
 * and the payment block `place()` uses to short-circuit before the wire when a credential this
 * provider cannot charge is handed to it.
 */
export class VrioPayload {
  private static readonly PAYMENT_METHOD_CARD = 1;

  static forOrder(order: OrderEnvelope, credential: PaymentCredential, credentials: VrioCredentials, shippingProfileId: number): Record<string, unknown> {
    const buyer = order.buyer;
    const billing = buyer.billing;
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
      // Billing is the shipping address unless the buyer gave a different one (`[13.2]`). The flag
      // and the full set are both sent because the payload known to work sends both, and the
      // provider is silent about which it honours, so the flag must agree with the fields.
      shipping_same: billing === null,
      bill_fname: billing?.firstName ?? buyer.firstName,
      bill_lname: billing?.lastName ?? buyer.lastName,
      bill_address1: billing?.addressLine ?? buyer.addressLine,
      bill_city: billing?.city ?? buyer.city,
      bill_state: billing?.territory ?? buyer.territory,
      bill_zipcode: billing?.postalCode ?? buyer.postalCode,
      bill_country: billing?.country ?? buyer.country,
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
