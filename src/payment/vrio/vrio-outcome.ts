import { CardScrubber } from '../../support/card-scrubber';
import { ChargeDiscrepancy } from '../charge-discrepancy';
import { PaymentCredential } from '../payment-credential';
import { PlacementOutcome } from '../placement-outcome';
import { SettlementMode, SettlementModeValue } from '../settlement-mode';
import { CardScheme } from './card-scheme';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function scalarToId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim() !== '') return value;
  return null;
}

function trimmedIdentifier(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  return null;
}

function toCents(amount: unknown): number | null {
  const n = typeof amount === 'number' ? amount : typeof amount === 'string' && amount.trim() !== '' && !Number.isNaN(Number(amount)) ? Number(amount) : null;
  return n === null ? null : Math.round(n * 100);
}

/**
 * Ported from storefront-lamp/core/Payment/Vrio/VrioOutcome.php. Classifies a raw Vrio envelope
 * into a `PlacementOutcome` — the single most intricate piece of the Vrio port. Branch order
 * matters throughout; see the PHP original's own extensive comments for why each check is ordered
 * the way it is (most importantly: the stored-credential refusal has no order id or transaction
 * node at all, so it must be checked before the missing-reference branch would otherwise catch it).
 */
export class VrioOutcome {
  static readonly GENERIC_DECLINE = 'We could not complete your payment. Please check your card details and try again.';
  static readonly STORED_CREDENTIAL_DECLINE = 'We could not charge your saved card. Your original order is unaffected.';
  private static readonly REFUSED_HANDLE_CODE = 'customer_card_invalid';
  private static readonly TERMINAL_STATUSES = new Set([2, 5, 7, 8]);

  static from(envelope: Record<string, unknown>, expectedTotalCents: number | null = null, settlement: SettlementModeValue = SettlementMode.Capture): PlacementOutcome {
    if (envelope.curlError !== undefined) {
      return PlacementOutcome.declined(null, VrioOutcome.GENERIC_DECLINE, 'transport_error');
    }

    const data = asRecord(envelope.data);
    const error = data ? asRecord(data.error) : null;
    if (error && error.code === VrioOutcome.REFUSED_HANDLE_CODE) {
      return PlacementOutcome.declined(null, VrioOutcome.STORED_CREDENTIAL_DECLINE, 'credential_refused');
    }

    const transaction = VrioOutcome.transactionNode(data, error);
    const reference = VrioOutcome.referenceOf(transaction);

    const responseCode = typeof transaction.response_code === 'number' ? transaction.response_code : null;
    if (responseCode === 101 && reference !== null) {
      const redirect = transaction.post_data;
      if (typeof redirect === 'string' && redirect !== '') {
        return PlacementOutcome.pendingAction(reference, redirect, '101');
      }
    }

    if (reference === null) {
      return PlacementOutcome.declined(null, VrioOutcome.reason(envelope), 'no_reference');
    }

    const order = asRecord(transaction.order);
    const status = order && typeof order.status_type_id === 'number' ? order.status_type_id : null;
    const rawStatus = status === null ? null : String(status);

    if (envelope.success !== true) {
      return PlacementOutcome.declined(reference, VrioOutcome.reason(envelope), rawStatus);
    }

    if (!VrioOutcome.isSettled(status, settlement)) {
      return PlacementOutcome.declined(reference, VrioOutcome.reason(envelope), rawStatus);
    }

    return PlacementOutcome.placed(
      reference,
      rawStatus,
      VrioOutcome.reconcile(transaction, expectedTotalCents),
      VrioOutcome.reusableCredential(data),
      settlement,
      null,
      VrioOutcome.providerCardBrand(data),
    );
  }

  private static transactionNode(data: Record<string, unknown> | null, error: Record<string, unknown> | null): Record<string, unknown> {
    const nested = error ? asRecord(error.transaction) : null;
    return nested ?? data ?? {};
  }

  private static referenceOf(transaction: Record<string, unknown>): string | null {
    const direct = scalarToId(transaction.order_id);
    if (direct !== null) return direct;
    const order = asRecord(transaction.order);
    return order ? scalarToId(order.order_id) : null;
  }

  private static isSettled(status: number | null, settlement: SettlementModeValue): boolean {
    if (status !== null && VrioOutcome.TERMINAL_STATUSES.has(status)) return false;
    return SettlementMode.isAuthorize(settlement) || status !== null;
  }

  private static reconcile(transaction: Record<string, unknown>, expectedTotalCents: number | null): ChargeDiscrepancy | null {
    if (expectedTotalCents === null) return null;
    const chargedCents = toCents(transaction.transaction_total);
    if (chargedCents === null || chargedCents === expectedTotalCents) return null;
    const order = asRecord(transaction.order);
    return new ChargeDiscrepancy(expectedTotalCents, chargedCents, order ? toCents(order.order_discount) : null);
  }

  private static reusableCredential(data: Record<string, unknown> | null): PaymentCredential | null {
    if (!data) return null;
    const order = asRecord(data.order) ?? {};
    const card = asRecord(order.customer_card) ?? {};

    const customerId = trimmedIdentifier(data.customer_id ?? order.customer_id);
    const cardId = trimmedIdentifier(order.customer_card_id ?? card.customer_card_id);
    if (customerId === null || cardId === null) return null;

    return PaymentCredential.stored({ customer_id: customerId, customer_card_id: cardId });
  }

  private static providerCardBrand(data: Record<string, unknown> | null): ReturnType<typeof CardScheme.brandFor> {
    const order = data ? asRecord(data.order) : null;
    const card = order ? asRecord(order.customer_card) : null;
    const code = card && typeof card.card_type_id === 'number' ? card.card_type_id : null;
    return code === null ? null : CardScheme.brandFor(code);
  }

  private static reason(envelope: Record<string, unknown>): string {
    const data = asRecord(envelope.data);
    const error = data ? asRecord(data.error) : null;
    const transaction = error ? asRecord(error.transaction) : null;

    const candidates: unknown[] = [
      envelope.message,
      error?.message,
      transaction?.gateway_response_text,
      transaction?.processor_response_text,
      transaction?.gateway_response_description,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim() !== '') {
        return CardScrubber.scrub(candidate.trim()) as string;
      }
    }

    return VrioOutcome.GENERIC_DECLINE;
  }
}
