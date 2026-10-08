import { Receipt, ReceiptShipping } from './receipt';

export interface ReceiptLineViewModel {
  slug: string;
  name: string;
  kind: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
}

/**
 * Ported from storefront-lamp/core/Completion/ReceiptViewModel.php. Everything the receipt page
 * renders, assembled once on the server — the template reads fields and iterates lists, deciding
 * nothing. A line total is computed here rather than in the template, because a template that
 * multiplied a unit price by a quantity would be a second authority on money.
 *
 * A projection of `Receipt` rather than the receipt itself, so the durable snapshot stays exactly
 * what `[4.17]` asks for and presentation never ends up in the `journey_state` column.
 *
 * **There is no case id** — the EMR's treatment record carries a null `provider_case_id` at the
 * moment a treatment is created, so there is nothing true to print yet.
 */
export class ReceiptViewModel {
  private constructor(
    public readonly references: string[],
    public readonly declinedReferences: string[],
    public readonly lines: ReceiptLineViewModel[],
    public readonly subtotalCents: number,
    public readonly discountCents: number,
    public readonly paidTotalCents: number,
    public readonly currency: string,
    public readonly promotionCode: string | null,
    public readonly buyerEmail: string,
    public readonly buyerName: string,
    public readonly buyerFirstName: string,
    public readonly buyerPhone: string,
    public readonly shipping: ReceiptShipping,
    public readonly shippingAddress: string,
    public readonly cardLastFour: string | null,
    public readonly paymentMethod: string | null,
    public readonly placedAt: string | null,
    public readonly pendingReview: boolean,
    public readonly orderNumber: string | null,
    public readonly itemCount: number,
    /** Whether the total on this page is reserved rather than taken — a bool, since the template's only question is which of two sentences to print. */
    public readonly authorizedOnly: boolean = false,
  ) {}

  static fromReceipt(receipt: Receipt): ReceiptViewModel {
    let itemCount = 0;
    const lines: ReceiptLineViewModel[] = receipt.lines.map((line) => {
      itemCount += line.quantity;
      return { ...line, line_total_cents: line.unit_price_cents * line.quantity };
    });

    return new ReceiptViewModel(
      receipt.references,
      receipt.declinedReferences,
      lines,
      receipt.subtotalCents,
      receipt.discountCents,
      receipt.paidTotalCents,
      receipt.currency,
      receipt.promotionCode,
      receipt.buyerEmail,
      receipt.buyerName,
      ReceiptViewModel.firstName(receipt.buyerName),
      receipt.buyerPhone,
      receipt.shipping,
      ReceiptViewModel.oneLine(receipt.shipping),
      receipt.cardLastFour,
      receipt.paymentMethod,
      receipt.placedAt,
      receipt.pendingReview,
      receipt.references[0] ?? null,
      itemCount,
      receipt.isAuthorizedOnly(),
    );
  }

  /** The page for a visitor the storefront cannot prove bought anything — not an error state, since an analytics/bookkeeping failure must not lock a buyer out of their own receipt (`[20.1]`). */
  static empty(currency: string): ReceiptViewModel {
    return ReceiptViewModel.fromReceipt(Receipt.fromOrderRows([], {}, currency));
  }

  /** Whether there is an order to show at all — the template's one structural branch. */
  hasOrder(): boolean {
    return this.references.length > 0;
  }

  /** Whether a discount row belongs on the summary — a zero one would show the buyer a saving they did not make. */
  hasDiscount(): boolean {
    return this.discountCents > 0;
  }

  private static oneLine(shipping: ReceiptShipping): string {
    return (['address_line', 'city', 'territory', 'postal_code', 'country'] as const)
      .map((field) => shipping[field].trim())
      .filter((value) => value !== '')
      .join(', ');
  }

  /** The first whitespace-separated word of the stored name — a single-word name greets by itself, an empty one greets by nothing. */
  private static firstName(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    return parts[0] ?? '';
  }
}
