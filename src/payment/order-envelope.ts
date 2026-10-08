import { Buyer } from './buyer';
import { OrderLine } from './order-line';
import { SettlementMode, SettlementModeValue } from './settlement-mode';

/**
 * Ported from storefront-lamp/core/Payment/OrderEnvelope.php. The whole cart, assembled once per
 * checkout submit, that `PaymentAdapter.place()` receives.
 */
export class OrderEnvelope {
  constructor(
    public readonly lines: OrderLine[],
    public readonly buyer: Buyer,
    public readonly subtotalCents: number,
    public readonly discountCents: number,
    public readonly totalCents: number,
    public readonly currency: string,
    public readonly promotionCode: string | null,
    public readonly attribution: Record<string, unknown>,
    public readonly sessionUuid: string | null,
    public readonly clientIp: string | null,
    public readonly userAgent: string | null,
    public readonly idempotencyKey: string,
    public readonly anchorSlug: string,
    public readonly settlement: SettlementModeValue = SettlementMode.Capture,
  ) {}

  chargeableLines(): OrderLine[] {
    return this.lines.filter((line) => line.isChargeable());
  }

  unmappedLines(): OrderLine[] {
    return this.lines.filter((line) => !line.isChargeable());
  }
}
