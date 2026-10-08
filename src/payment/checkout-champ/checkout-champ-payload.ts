import { Totals } from '../../checkout/totals';
import { OrderEnvelope } from '../order-envelope';
import { OrderLine } from '../order-line';
import { PaymentCredential } from '../payment-credential';

/**
 * Ported from storefront-lamp/core/Payment/CheckoutChamp/CheckoutChampPayload.php. Builds every
 * request body this adapter sends. All methods are pure — take value objects, return plain param
 * objects for the client's query string.
 */
export class CheckoutChampPayload {
  private static readonly QA_APPROVE = 'APPROVE';

  /** POST /leads/import/ */
  static forLead(order: OrderEnvelope, salesUrl: string = ''): Record<string, unknown> {
    const buyer = order.buyer;

    const body: Record<string, unknown> = {
      ...CheckoutChampPayload.shipping(order),
      campaignId: String(CheckoutChampPayload.campaignFor(order)),
      firstName: buyer.firstName,
      lastName: buyer.lastName,
      emailAddress: buyer.email,
      phoneNumber: buyer.phone,
      address1: buyer.addressLine,
      city: buyer.city,
      state: buyer.territory,
      postalCode: buyer.postalCode,
      country: buyer.country,
      billFirstName: buyer.firstName,
      billLastName: buyer.lastName,
      billAddress1: buyer.addressLine,
      billCity: buyer.city,
      billState: buyer.territory,
      billPostalCode: buyer.postalCode,
      billCountry: buyer.country,
      ipAddress: order.clientIp ?? '',
    };

    if (order.sessionUuid !== null && order.sessionUuid !== '') body.requestUri = order.sessionUuid;
    if (salesUrl !== '') body.salesUrl = salesUrl;

    return body;
  }

  /** The ONE providerOffer shared by every chargeable line, or `null` on 0 or more than 1 distinct value. */
  static campaignFor(order: OrderEnvelope): string | null {
    return CheckoutChampPayload.campaignOf(order.chargeableLines());
  }

  static campaignOf(lines: OrderLine[]): string | null {
    const campaigns = new Set<string>();
    for (const line of lines) {
      if (line.isChargeable()) campaigns.add(String(line.providerOffer));
    }
    return campaigns.size === 1 ? [...campaigns][0] : null;
  }

  /** POST /order/import/ or /order/preauth/ */
  static forOrder(order: OrderEnvelope, credential: PaymentCredential, reference: string, holdForReview: boolean = false): Record<string, unknown> {
    const body: Record<string, unknown> = {
      campaignId: String(CheckoutChampPayload.campaignFor(order)),
      orderId: reference,
      ...CheckoutChampPayload.shipping(order),
      ...CheckoutChampPayload.lines(order),
      ...CheckoutChampPayload.paymentFor(credential),
    };

    if (holdForReview) body.forceQA = 1;
    return body;
  }

  /** POST /order/qa/ — settle the QA-held order. Field name is `action`, NOT `qaStatus` (the live API rejects `qaStatus` despite the client's own README documenting it). */
  static forQaApproval(reference: string): Record<string, unknown> {
    return { orderId: reference, action: CheckoutChampPayload.QA_APPROVE };
  }

  /** POST /order/import/ again, to SETTLE a preauthorized order — lines resent, no card, no shipping. */
  static forCapture(reference: string, lines: OrderLine[], campaignId: string): Record<string, unknown> {
    return { campaignId, orderId: reference, ...CheckoutChampPayload.numbered(lines) };
  }

  private static shipping(order: OrderEnvelope): Record<string, unknown> {
    const buyer = order.buyer;
    return {
      shipFirstName: buyer.firstName,
      shipLastName: buyer.lastName,
      shipAddress1: buyer.addressLine,
      shipCity: buyer.city,
      shipState: buyer.territory,
      shipPostalCode: buyer.postalCode,
      shipCountry: buyer.country,
    };
  }

  private static lines(order: OrderEnvelope): Record<string, unknown> {
    return CheckoutChampPayload.numbered(order.chargeableLines());
  }

  /** One-based numbered params: product{N}_id / product{N}_qty / product{N}_price. Only chargeable lines are numbered — no gap is ever left. */
  private static numbered(lines: OrderLine[]): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    let position = 0;
    for (const line of lines) {
      position++;
      params[`product${position}_id`] = String(line.providerItem);
      params[`product${position}_qty`] = line.quantity;
      params[`product${position}_price`] = Totals.decimalString(line.unitPriceCents);
    }
    return params;
  }

  /** `{}` (= "cannot charge") for anything but card/stored-instrument. */
  static paymentFor(credential: PaymentCredential): Record<string, unknown> {
    if (credential.kind === PaymentCredential.KIND_CARD) {
      return {
        paySource: 'CREDITCARD',
        cardNumber: credential.number ?? '',
        cardMonth: credential.expiryMonth ?? '',
        cardYear: credential.expiryYear ?? '',
        cardSecurityCode: credential.securityCode ?? '',
      };
    }

    if (credential.kind === PaymentCredential.KIND_STORED_INSTRUMENT) {
      const customerId = credential.handle?.customer_id ?? '';
      if (customerId === '') return {};
      return { paySource: 'ACCTONFILE', customerId };
    }

    return {};
  }
}
