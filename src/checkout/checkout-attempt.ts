import { ChargeDiscrepancy } from '../payment/charge-discrepancy';
import { PlacementOutcome } from '../payment/placement-outcome';
import { CardScrubber } from '../support/card-scrubber';
import { CheckoutAttemptRepository, CheckoutAttemptRow } from '../repository/checkout-attempt-repository';

/**
 * Ported from storefront-lamp/core/Checkout/CheckoutAttempt.php. The record of one checkout
 * submission and what came of it.
 *
 * **Three states, because two cannot answer the question that matters.** An attempt is `claimed`
 * before anything is sent, `sent` the instant before the provider is contacted, and `complete` once
 * an outcome is known. Only a `claimed` row may ever be taken over — the provider has no idempotency
 * of its own, and re-posting an identical payload creates and charges a second order.
 */
export class CheckoutAttempt {
  /**
   * The `rawStatus` values that mean nobody can say whether money moved. The test is "could this
   * have charged the card", not "did the charge fail" — `no_provider_configured` is deliberately
   * absent: `NullPaymentAdapter` is the only source of it, and it exists precisely because there is
   * no gateway, so no card can have been presented.
   */
  private static readonly UNRESOLVED_STATUSES = ['transport_error', 'exception', 'no_reference'];

  constructor(
    public readonly key: string,
    public readonly state: string,
    public readonly outcome: PlacementOutcome | null,
  ) {}

  static fromRow(row: CheckoutAttemptRow): CheckoutAttempt {
    return new CheckoutAttempt(row.key, row.state, row.outcome === null ? null : CheckoutAttempt.decodeOutcome(row.outcome));
  }

  isClaimed(): boolean {
    return this.state === CheckoutAttemptRepository.STATE_CLAIMED;
  }

  isSent(): boolean {
    return this.state === CheckoutAttemptRepository.STATE_SENT;
  }

  isComplete(): boolean {
    return this.state === CheckoutAttemptRepository.STATE_COMPLETE;
  }

  /**
   * Whether this outcome entitles the submission to its key back. Only a decline the provider
   * itself answered with — a placement and a challenge both leave an order in existence at the
   * provider and keep the key forever; an unresolved outcome keeps it because nobody can say the
   * card was not charged.
   */
  static releasesKey(outcome: PlacementOutcome): boolean {
    if (outcome.state !== PlacementOutcome.DECLINED) return false;
    return !CheckoutAttempt.UNRESOLVED_STATUSES.includes(outcome.rawStatus ?? '');
  }

  static encodeOutcome(outcome: PlacementOutcome): Record<string, unknown> {
    const discrepancy = outcome.chargeDiscrepancy;

    return {
      state: outcome.state,
      reference: outcome.reference,
      reason: outcome.reason === null ? null : CardScrubber.scrub(outcome.reason),
      raw_status: outcome.rawStatus,
      action_url: outcome.actionUrl === null ? null : CardScrubber.scrub(outcome.actionUrl),
      charge_discrepancy:
        discrepancy === null
          ? null
          : {
              expected_cents: discrepancy.expectedCents,
              charged_cents: discrepancy.chargedCents,
              provider_discount_cents: discrepancy.providerDiscountCents,
            },
    };
  }

  static decodeOutcome(stored: Record<string, unknown>): PlacementOutcome | null {
    const state = stored.state;
    const reference = typeof stored.reference === 'string' ? stored.reference : null;
    const rawStatus = typeof stored.raw_status === 'string' ? stored.raw_status : null;
    const actionUrl = typeof stored.action_url === 'string' ? stored.action_url : null;

    switch (state) {
      case PlacementOutcome.PLACED:
        return reference === null ? null : PlacementOutcome.placed(reference, rawStatus, CheckoutAttempt.decodeDiscrepancy(stored.charge_discrepancy));
      case PlacementOutcome.DECLINED:
        return PlacementOutcome.declined(reference, typeof stored.reason === 'string' ? stored.reason : '', rawStatus);
      case PlacementOutcome.PENDING_ACTION:
        return reference === null || actionUrl === null ? null : PlacementOutcome.pendingAction(reference, actionUrl, rawStatus);
      default:
        return null;
    }
  }

  private static decodeDiscrepancy(stored: unknown): ChargeDiscrepancy | null {
    if (
      stored === null ||
      typeof stored !== 'object' ||
      typeof (stored as Record<string, unknown>).expected_cents !== 'number' ||
      typeof (stored as Record<string, unknown>).charged_cents !== 'number'
    ) {
      return null;
    }

    const row = stored as Record<string, unknown>;
    const providerDiscount = row.provider_discount_cents;

    return new ChargeDiscrepancy(row.expected_cents as number, row.charged_cents as number, typeof providerDiscount === 'number' ? providerDiscount : null);
  }
}
