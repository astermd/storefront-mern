import { CardDescriptor } from './card-descriptor';
import { Totals } from '../checkout/totals';

/**
 * Ported from storefront-lamp/core/Payment/PaymentDescriptor.php. What a receipt/order record
 * shows about how payment was collected.
 */
export class PaymentDescriptor {
  static readonly TYPE_CREDIT_CARD = 'credit_card';

  constructor(
    public readonly type: string,
    public readonly preAuth: boolean,
    public readonly preAuthQa: boolean | null = null,
    public readonly preAuthAmountCents: number | null = null,
    public readonly card: CardDescriptor | null = null,
  ) {}

  toArray(): Record<string, unknown> {
    const out: Record<string, unknown> = { type: this.type, pre_auth: this.preAuth };

    // Only present when `preAuth && preAuthQa === true` — never a stated `false`.
    if (this.preAuth && this.preAuthQa === true) {
      out.pre_auth_qa = true;
    }
    if (this.preAuthAmountCents !== null) {
      out.pre_auth_amount = Totals.dollars(this.preAuthAmountCents);
    }
    if (this.card !== null) {
      out.card = this.card.toArray();
    }

    return out;
  }
}
