import { PlacementOutcome } from '../payment/placement-outcome';
import { SettlementMode, SettlementModeValue } from '../payment/settlement-mode';

export interface ReceiptLine {
  slug: string;
  name: string;
  kind: string;
  quantity: number;
  unit_price_cents: number;
}

export interface ReceiptShipping {
  name: string;
  address_line: string;
  city: string;
  territory: string;
  postal_code: string;
  country: string;
}

/** The shape `OrderRepository.findByReference()` returns — a Prisma `Order` with its `lines` relation included. */
export interface OrderRowForReceipt {
  providerReference: string;
  status: string;
  currency: string;
  promotionCode: string | null;
  buyerEmail: string | null;
  buyerName: string | null;
  buyerTerritory: string | null;
  cardLastFour: string | null;
  paymentMethod: string | null;
  placedAt: string | null;
  amountCents: number;
  discountCents: number;
  settlement: string;
  lines: Array<{ slug: string; name: string; kind: string; quantity: number; unitPriceCents: number }>;
}

/**
 * Ported from storefront-lamp/core/Completion/Receipt.php. The retained order receipt (`[4.17]`).
 *
 * Built from the **local order rows** at completion, before the journey is wiped, and then held in
 * journey state as the only thing a refresh reads. `paidTotalCents` is the sum of the placed orders'
 * `amountCents`, computed here rather than accumulated in journey state — a running counter would
 * be a second authority on money.
 *
 * **Where each field comes from is one rule.** Every figure and every reference comes from the rows.
 * The buyer's contact and shipping details come from journey state (the rows keep only an email, a
 * name and a territory — no street address), falling back to the row when journey state no longer
 * holds them.
 *
 * **Only a placed order is money.** A declined placement still gets a row and a reference, kept
 * separately and never counted in the total.
 *
 * No card reaches here — the rows carry four digits and nothing more (`[15.8]`).
 */
export class Receipt {
  private static readonly SHIPPING_FIELDS = ['name', 'address_line', 'city', 'territory', 'postal_code', 'country'] as const;

  private constructor(
    public readonly references: string[],
    public readonly declinedReferences: string[],
    public readonly lines: ReceiptLine[],
    public readonly subtotalCents: number,
    public readonly discountCents: number,
    public readonly paidTotalCents: number,
    public readonly currency: string,
    public readonly promotionCode: string | null,
    public readonly buyerEmail: string,
    public readonly buyerName: string,
    public readonly buyerPhone: string,
    public readonly shipping: ReceiptShipping,
    public readonly cardLastFour: string | null,
    public readonly paymentMethod: string | null,
    public readonly placedAt: string | null,
    public readonly pendingReview: boolean,
    public readonly settlement: SettlementModeValue = SettlementMode.Capture,
  ) {}

  isAuthorizedOnly(): boolean {
    return this.settlement === SettlementMode.Authorize;
  }

  /**
   * The receipt for one journey's orders. An empty row set is an ordinary input, not an error — the
   * money moves before the local write, so a write that failed leaves a charged buyer with no row,
   * and that buyer is still entitled to a page.
   */
  static fromOrderRows(orders: OrderRowForReceipt[], buyer: Record<string, string>, currency: string): Receipt {
    const placed = orders.filter((row) => row.status === PlacementOutcome.PLACED);
    const declined = orders.filter((row) => row.status !== PlacementOutcome.PLACED);

    const lines: ReceiptLine[] = [];
    let subtotal = 0;
    let paid = 0;
    let discount = 0;

    for (const row of placed) {
      paid += row.amountCents;
      discount += row.discountCents;

      for (const line of row.lines) {
        lines.push({ slug: line.slug, name: line.name, kind: line.kind, quantity: line.quantity, unit_price_cents: line.unitPriceCents });
        subtotal += line.unitPriceCents * line.quantity;
      }
    }

    const name = `${buyer.first_name ?? ''} ${buyer.last_name ?? ''}`.trim();

    return new Receipt(
      placed.map((row) => row.providerReference),
      declined.map((row) => row.providerReference),
      lines,
      subtotal,
      discount,
      paid,
      Receipt.firstOf(placed, (r) => r.currency) ?? currency,
      Receipt.firstOf(placed, (r) => r.promotionCode),
      (buyer.email ?? '').trim() || (Receipt.firstOf(placed, (r) => r.buyerEmail) ?? ''),
      name !== '' ? name : (Receipt.firstOf(placed, (r) => r.buyerName) ?? ''),
      (buyer.phone ?? '').trim(),
      {
        name,
        address_line: (buyer.address_line ?? '').trim(),
        city: (buyer.city ?? '').trim(),
        territory: (buyer.territory ?? '').trim() || (Receipt.firstOf(placed, (r) => r.buyerTerritory) ?? ''),
        postal_code: (buyer.postal_code ?? '').trim(),
        // `[13.36]` is a declared gap: country is not collected. Empty rather than assumed.
        country: (buyer.country ?? '').trim(),
      },
      Receipt.firstOf(placed, (r) => r.cardLastFour),
      Receipt.firstOf(placed, (r) => r.paymentMethod),
      Receipt.firstOf(placed, (r) => r.placedAt),
      true,
      Receipt.settlementOf(placed),
    );
  }

  /** The same "authorize wins" rule the cart resolves with, applied again — a journey can place more than one order (a checkout, then an upsell), and they settle independently. */
  private static settlementOf(placed: OrderRowForReceipt[]): SettlementModeValue {
    const modes = placed.map((row) => SettlementMode.parse(row.settlement) ?? SettlementMode.Capture);
    return SettlementMode.strictest(...modes);
  }

  /** The durable shape journey state holds — snake-cased to match the rest of the `journey_state` blob. */
  toArray(): Record<string, unknown> {
    return {
      references: this.references,
      declined_references: this.declinedReferences,
      lines: this.lines,
      subtotal_cents: this.subtotalCents,
      discount_cents: this.discountCents,
      paid_total_cents: this.paidTotalCents,
      currency: this.currency,
      promotion_code: this.promotionCode,
      buyer_email: this.buyerEmail,
      buyer_name: this.buyerName,
      buyer_phone: this.buyerPhone,
      shipping: this.shipping,
      card_last_four: this.cardLastFour,
      payment_method: this.paymentMethod,
      placed_at: this.placedAt,
      pending_review: this.pendingReview,
      settlement: this.settlement,
    };
  }

  /** A stored receipt, read back defensively — every field degrades rather than throws. */
  static fromArray(stored: Record<string, unknown>): Receipt {
    const rawShipping = (stored.shipping && typeof stored.shipping === 'object' ? stored.shipping : {}) as Record<string, unknown>;
    const shippingFields: Record<string, string> = {};
    for (const field of Receipt.SHIPPING_FIELDS) {
      shippingFields[field] = Receipt.text(rawShipping[field]);
    }
    const shipping = shippingFields as unknown as ReceiptShipping;

    return new Receipt(
      Receipt.references(stored.references),
      Receipt.references(stored.declined_references),
      Receipt.lines(stored.lines),
      Receipt.number(stored.subtotal_cents),
      Receipt.number(stored.discount_cents),
      Receipt.number(stored.paid_total_cents),
      Receipt.text(stored.currency),
      Receipt.nullableText(stored.promotion_code),
      Receipt.text(stored.buyer_email),
      Receipt.text(stored.buyer_name),
      Receipt.text(stored.buyer_phone),
      shipping,
      Receipt.nullableText(stored.card_last_four),
      Receipt.nullableText(stored.payment_method),
      Receipt.nullableText(stored.placed_at),
      true,
      SettlementMode.parse(stored.settlement) ?? SettlementMode.Capture,
    );
  }

  private static line(raw: unknown): ReceiptLine | null {
    if (raw === null || typeof raw !== 'object') return null;
    const row = raw as Record<string, unknown>;
    const slug = Receipt.text(row.slug);
    if (slug === '') return null;

    return { slug, name: Receipt.text(row.name), kind: Receipt.text(row.kind), quantity: Receipt.number(row.quantity), unit_price_cents: Receipt.number(row.unit_price_cents) };
  }

  private static lines(raw: unknown): ReceiptLine[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((line) => Receipt.line(line)).filter((line): line is ReceiptLine => line !== null);
  }

  private static references(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((value) => Receipt.text(value)).filter((value) => value !== '');
  }

  private static firstOf<T>(rows: T[], read: (row: T) => string | null | undefined): string | null {
    for (const row of rows) {
      const value = Receipt.text(read(row));
      if (value !== '') return value;
    }
    return null;
  }

  private static text(value: unknown): string {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value).trim() : '';
  }

  private static nullableText(value: unknown): string | null {
    const text = Receipt.text(value);
    return text === '' ? null : text;
  }

  private static number(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }
}
