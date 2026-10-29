import { OrderLine } from './order-line';

/**
 * Ported from storefront-lamp/core/Payment/CaptureRequest.php. One provider needs the reference
 * alone; another needs the lines resent (its pre-authorized order carries empty `items` until
 * settle time and can't be re-read).
 */
export class CaptureRequest {
  constructor(
    public readonly reference: string,
    public readonly lines: OrderLine[] = [],
    /** Resent so a settling call that re-prices the lines keeps the discount; an adapter settling from the reference alone ignores it. */
    public readonly promotionCode: string | null = null,
  ) {}

  chargeableLines(): OrderLine[] {
    return this.lines.filter((line) => line.isChargeable());
  }
}
