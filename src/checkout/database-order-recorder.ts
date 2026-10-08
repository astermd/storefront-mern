import { Injectable } from '@nestjs/common';
import { OrderEnvelope } from '../payment/order-envelope';
import { PaymentCredential } from '../payment/payment-credential';
import { PlacementOutcome } from '../payment/placement-outcome';
import { OrderRepository } from '../repository/order-repository';
import { OperatorLog } from '../support/operator-log';
import { CardScrubber } from '../support/card-scrubber';
import { ConsentRecord } from './consent-record';
import { OrderRecorder } from './order-recorder';

/**
 * Ported from storefront-lamp/core/Checkout/DatabaseOrderRecorder.php. Writes the placement to the
 * `orders`/`order_lines`/`order_consents` tables via `OrderRepository`.
 *
 * A write failure is logged and swallowed, never thrown — every caller runs this inside
 * `PostChargeGuard.run()` already, but this class holds the same discipline independently rather
 * than trusting every future call site to remember to wrap it (`[20.1]`).
 */
@Injectable()
export class DatabaseOrderRecorder implements OrderRecorder {
  constructor(
    private readonly orders: OrderRepository,
    private readonly log: OperatorLog,
  ) {}

  async record(
    order: OrderEnvelope,
    outcome: PlacementOutcome,
    credential: PaymentCredential,
    consents: ConsentRecord[],
    providerCategory: string,
    isUpsell = false,
  ): Promise<number | null> {
    try {
      return await this.orders.insert(
        {
          session_uuid: order.sessionUuid,
          provider_reference: outcome.reference ?? '',
          anchor_slug: order.anchorSlug,
          amount_cents: order.totalCents,
          currency: order.currency,
          status: outcome.state,
          buyer_email: order.buyer.email,
          buyer_name: `${order.buyer.firstName} ${order.buyer.lastName}`.trim(),
          buyer_territory: order.buyer.territory,
          discount_cents: order.discountCents,
          promotion_code: order.promotionCode,
          payment_method: 'card',
          card_last_four: credential.lastFour() || null,
          idempotency_key: order.idempotencyKey,
          provider_category: providerCategory,
          is_upsell: isUpsell,
          settlement: order.settlement,
          user_agent: order.userAgent,
        },
        order.lines.map((line) => ({
          slug: line.slug,
          name: line.name,
          kind: line.kind,
          provider_offer: line.providerOffer,
          provider_item: line.providerItem,
          unit_price_cents: line.unitPriceCents,
          quantity: line.quantity,
          sent_to_provider: line.isChargeable(),
        })),
        consents.map((consent) => ({
          key: consent.key,
          granted: consent.granted,
          copy_version: consent.copyVersion,
          copy_shown: consent.copyShown,
          at: consent.at,
        })),
      );
    } catch (error) {
      this.log.error('checkout.order_not_recorded', { reason: CardScrubber.scrub(error instanceof Error ? error.message : String(error)) });
      return null;
    }
  }
}
