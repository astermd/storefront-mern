import { CardScrubber } from '../../support/card-scrubber';
import { ChargeDiscrepancy } from '../charge-discrepancy';
import { PaymentCredential } from '../payment-credential';
import { PlacementOutcome } from '../placement-outcome';
import { SettlementMode, SettlementModeValue } from '../settlement-mode';
import { CheckoutChampCardType } from './checkout-champ-card-type';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  return null;
}

function toCents(amount: unknown): number | null {
  const n = typeof amount === 'number' ? amount : typeof amount === 'string' && amount.trim() !== '' && !Number.isNaN(Number(amount)) ? Number(amount) : null;
  return n === null ? null : Math.round(n * 100);
}

/**
 * Ported from storefront-lamp/core/Payment/CheckoutChamp/CheckoutChampOutcome.php. `result` is the
 * ONLY success/failure discriminator this provider gives — never infer it from the shape of
 * `message`, which arrives as either an object (placed order, or a field-validation map) or a
 * plain string (a human-readable success or decline sentence), with all four combinations recorded
 * live: `{SUCCESS, object}`, `{SUCCESS, string}` (e.g. "Card is preauthorized" — still placed, with
 * no orderId/total at all), `{ERROR, string}` (shown to the buyer verbatim), `{ERROR, object}`
 * (a field map — NEVER shown to the buyer; `GENERIC_DECLINE` substituted instead).
 */
export class CheckoutChampOutcome {
  static readonly GENERIC_DECLINE = 'We could not complete your payment. Please check your card details and try again.';
  private static readonly RESULT_SUCCESS = 'SUCCESS';

  static from(
    envelope: Record<string, unknown>,
    reference: string,
    expectedTotalCents: number | null = null,
    settlement: SettlementModeValue = SettlementMode.Capture,
    preAuthQa: boolean = false,
  ): PlacementOutcome {
    if (envelope.curlError !== undefined) {
      return PlacementOutcome.declined(reference, CheckoutChampOutcome.GENERIC_DECLINE, 'transport_error');
    }

    if (envelope.result !== CheckoutChampOutcome.RESULT_SUCCESS) {
      return PlacementOutcome.declined(reference, CheckoutChampOutcome.reason(envelope), 'rejected');
    }

    const message = asRecord(envelope.message) ?? {};

    return PlacementOutcome.placed(
      reference,
      text(message.orderStatus),
      CheckoutChampOutcome.reconcile(message, expectedTotalCents),
      CheckoutChampOutcome.reusableCredential(message),
      settlement,
      preAuthQa,
      CheckoutChampCardType.brandFor(message.cardType),
    );
  }

  static capturedFrom(envelope: Record<string, unknown>): boolean {
    return envelope.curlError === undefined && envelope.result === CheckoutChampOutcome.RESULT_SUCCESS;
  }

  /** Reads `orderId` from the lead call's own response — separate from `from()`, which takes the reference as a parameter instead. */
  static referenceFrom(envelope: Record<string, unknown>): string | null {
    if (envelope.curlError !== undefined || envelope.result !== CheckoutChampOutcome.RESULT_SUCCESS) return null;
    const message = asRecord(envelope.message) ?? {};
    return text(message.orderId);
  }

  private static reason(envelope: Record<string, unknown>): string {
    const message = envelope.message;
    if (typeof message === 'string' && message.trim() !== '') {
      return CardScrubber.scrub(message.trim()) as string;
    }
    // A field-validation map is never shown to the buyer — only via the adapter's operator log.
    return CheckoutChampOutcome.GENERIC_DECLINE;
  }

  private static reconcile(message: Record<string, unknown>, expectedTotalCents: number | null): ChargeDiscrepancy | null {
    if (expectedTotalCents === null) return null;
    const chargedCents = toCents(message.totalAmount);
    if (chargedCents === null || chargedCents === expectedTotalCents) return null;
    return new ChargeDiscrepancy(expectedTotalCents, chargedCents, toCents(message.discountAmount));
  }

  private static reusableCredential(message: Record<string, unknown>): PaymentCredential | null {
    const customerId = text(message.customerId);
    return customerId === null ? null : PaymentCredential.stored({ customer_id: customerId });
  }
}
