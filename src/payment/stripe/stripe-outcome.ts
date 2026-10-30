import { CardBrand, CardBrandValue } from '../card-brand';
import { ChargeDiscrepancy } from '../charge-discrepancy';
import { PaymentCredential } from '../payment-credential';
import { PlacementOutcome } from '../placement-outcome';
import { SettlementMode, SettlementModeValue } from '../settlement-mode';

type Row = Record<string, unknown>;

/**
 * Ported from storefront-lamp/core/Payment/Stripe/StripeOutcome.php. A PaymentIntent, as a
 * `PlacementOutcome`.
 *
 * Read from the PaymentIntent's plain-object form (what the `stripe` package returns), so the
 * mapping is a pure function a test can drive from a recorded response.
 *
 * **Its status is the whole answer**, and each one means what the EMR will read it as when the
 * order is synced:
 *
 * - `succeeded`: charged.
 * - `requires_capture`: held, to be captured by the EMR when the doctor completes the case — placed,
 *   with `SettlementMode.Authorize`.
 * - `processing`: accepted and still settling; the EMR books it unpaid until Stripe says otherwise,
 *   and so is it placed here.
 * - `requires_action`: the bank wants the buyer to verify (`[14.22]`). Pending, carrying the client
 *   secret Stripe's script needs to run that step — in memory only, see `PlacementOutcome`.
 * - Anything else — `requires_payment_method` above all, which is a refused card or a failed
 *   verification — took no money: a decline, with Stripe's own message when it gave one, because
 *   Stripe writes that message for the buyer.
 *
 * **What survives to pay for the next charge is the customer and the card together**
 * (`PaymentCredential.stored()`). Stripe only lets a saved card be charged against the customer it
 * is attached to, so the pair is what an upsell on this journey submits, and it is minted here from
 * Stripe's own answer rather than ever taken from a request.
 */
export class StripeOutcome {
  /** What the buyer is told when Stripe gave nothing better. */
  static readonly GENERIC_DECLINE = 'We could not complete your payment. Please check your card details and try again.';

  /** Stripe's card brand → the storefront's. A brand not listed is no brand rather than a guess. */
  private static readonly BRANDS: Record<string, CardBrandValue> = {
    visa: CardBrand.Visa,
    mastercard: CardBrand.Mastercard,
    amex: CardBrand.Amex,
    discover: CardBrand.Discover,
    diners: CardBrand.DinersClub,
    jcb: CardBrand.Jcb,
  };

  /**
   * @param paymentIntent the PaymentIntent, `payment_method` expanded where available
   * @param expectedTotalCents what the buyer was shown, when there is a figure to hold it to
   */
  static from(paymentIntent: Row, expectedTotalCents: number | null = null): PlacementOutcome {
    const reference = StripeOutcome.text(paymentIntent.id);
    const status = StripeOutcome.text(paymentIntent.status);

    if (reference === null) {
      // A body with no id is a payment nobody can find again, which is the one shape that cannot
      // rule out a charge.
      return PlacementOutcome.declined(null, StripeOutcome.GENERIC_DECLINE, 'no_reference');
    }

    switch (status) {
      case 'succeeded':
      case 'processing':
        return StripeOutcome.placed(paymentIntent, reference, status, SettlementMode.Capture, expectedTotalCents);
      case 'requires_capture':
        return StripeOutcome.placed(paymentIntent, reference, status, SettlementMode.Authorize, expectedTotalCents);
      case 'requires_action':
        return PlacementOutcome.pendingAction(reference, StripeOutcome.redirectUrl(paymentIntent) ?? '', status, StripeOutcome.text(paymentIntent.client_secret));
      default:
        return PlacementOutcome.declined(reference, StripeOutcome.buyerMessage(paymentIntent.last_payment_error) ?? StripeOutcome.GENERIC_DECLINE, status ?? 'unknown');
    }
  }

  /**
   * A refusal Stripe answered with an error rather than a PaymentIntent — a declined card on the
   * confirming call.
   *
   * Stripe's message on a card error is written for the buyer ("Your card has insufficient
   * funds."), so it is shown as it is (`[13.28]`); the decline code is the operator's.
   *
   * @param reference the PaymentIntent the error was raised on, when Stripe named one
   */
  static fromCardError(reference: string | null, message: string | null, declineCode: string | null): PlacementOutcome {
    const text = message === null ? '' : message.trim();

    return PlacementOutcome.declined(reference, text !== '' ? text : StripeOutcome.GENERIC_DECLINE, declineCode !== null && declineCode !== '' ? declineCode : 'card_declined');
  }

  private static placed(paymentIntent: Row, reference: string, status: string, settlement: SettlementModeValue, expectedTotalCents: number | null): PlacementOutcome {
    const amount = paymentIntent.amount;
    const discrepancy =
      expectedTotalCents !== null && Number.isInteger(amount) && amount !== expectedTotalCents ? new ChargeDiscrepancy(expectedTotalCents, amount as number) : null;

    const card = StripeOutcome.card(paymentIntent.payment_method);

    return PlacementOutcome.placed(
      reference,
      status,
      discrepancy,
      StripeOutcome.reusable(paymentIntent),
      settlement,
      null,
      card === null ? null : (StripeOutcome.BRANDS[String(card.brand ?? '')] ?? null),
      card === null ? null : StripeOutcome.expiry(card),
    );
  }

  /** The customer and card a later charge may use, or null when Stripe kept no card against a customer for this payment. */
  private static reusable(paymentIntent: Row): PaymentCredential | null {
    const customer = StripeOutcome.idOf(paymentIntent.customer);
    const method = StripeOutcome.idOf(paymentIntent.payment_method);

    if (customer === null || method === null) return null;

    return PaymentCredential.stored({ customer, payment_method: method });
  }

  /** The expanded PaymentMethod's card. */
  private static card(paymentMethod: unknown): Row | null {
    const card = StripeOutcome.asRow(paymentMethod)?.card;

    return StripeOutcome.asRow(card);
  }

  private static expiry(card: Row): string | null {
    const month = card.exp_month;
    const year = card.exp_year;

    if (!Number.isInteger(month) || !Number.isInteger(year) || (month as number) < 1 || (month as number) > 12) return null;

    return `${String(month).padStart(2, '0')}/${String((year as number) % 100).padStart(2, '0')}`;
  }

  private static redirectUrl(paymentIntent: Row): string | null {
    const redirect = StripeOutcome.asRow(StripeOutcome.asRow(paymentIntent.next_action)?.redirect_to_url);

    return redirect === null ? null : StripeOutcome.text(redirect.url);
  }

  private static buyerMessage(error: unknown): string | null {
    const message = StripeOutcome.asRow(error)?.message;

    return typeof message === 'string' ? StripeOutcome.text(message.trim()) : null;
  }

  /** An id, whether Stripe answered with the id or the expanded object. */
  static idOf(value: unknown): string | null {
    const row = StripeOutcome.asRow(value);

    return StripeOutcome.text(row !== null ? row.id : value);
  }

  private static asRow(value: unknown): Row | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null;
  }

  private static text(value: unknown): string | null {
    return typeof value === 'string' && value !== '' ? value : null;
  }
}
