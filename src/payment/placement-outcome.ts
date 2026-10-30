import { CardBrandValue } from './card-brand';
import { ChargeDiscrepancy } from './charge-discrepancy';
import { PaymentCredential } from './payment-credential';
import { SettlementMode, SettlementModeValue } from './settlement-mode';

/**
 * Ported from storefront-lamp/core/Payment/PlacementOutcome.php — the central result type every
 * `PaymentAdapter.place()` call returns.
 *
 * `providerCardExpiry` (`MM/YY`) is for a credential that carries no card of its own: a token
 * collected in the provider's fields leaves the storefront nothing to read an expiry from.
 *
 * **`clientAction` is the one field that must never outlive the request.** It is what a pending
 * outcome hands the provider's own script on the page to run a challenge (`[14.22]`), and for at
 * least one provider it is a secret that can confirm the payment. So it is in memory only:
 * `CheckoutAttempt.encodeOutcome()` does not carry it, the instrumentation does not log it, and a
 * later request that needs it again asks the adapter through `PaymentAdapter.resume()`.
 */
export class PlacementOutcome {
  static readonly PLACED = 'placed';
  static readonly DECLINED = 'declined';
  static readonly PENDING_ACTION = 'pending_action';

  private constructor(
    public readonly state: string,
    public readonly reference: string | null,
    public readonly reason: string | null,
    public readonly rawStatus: string | null,
    public readonly actionUrl: string | null,
    public readonly chargeDiscrepancy: ChargeDiscrepancy | null = null,
    public readonly reusableCredential: PaymentCredential | null = null,
    public readonly settlement: SettlementModeValue = SettlementMode.Capture,
    public readonly preAuthQa: boolean | null = null,
    public readonly providerCardBrand: CardBrandValue | null = null,
    public readonly providerCardExpiry: string | null = null,
    public readonly clientAction: string | null = null,
  ) {}

  static placed(
    reference: string,
    rawStatus: string | null = null,
    discrepancy: ChargeDiscrepancy | null = null,
    reusableCredential: PaymentCredential | null = null,
    settlement: SettlementModeValue = SettlementMode.Capture,
    preAuthQa: boolean | null = null,
    providerCardBrand: CardBrandValue | null = null,
    providerCardExpiry: string | null = null,
  ): PlacementOutcome {
    return new PlacementOutcome(
      PlacementOutcome.PLACED,
      reference,
      null,
      rawStatus,
      null,
      discrepancy,
      reusableCredential,
      settlement,
      preAuthQa,
      providerCardBrand,
      providerCardExpiry,
    );
  }

  static declined(reference: string | null, reason: string, rawStatus: string | null = null): PlacementOutcome {
    return new PlacementOutcome(PlacementOutcome.DECLINED, reference, reason, rawStatus, null);
  }

  /** `clientAction` is what the provider's script on the page needs to run the challenge; never persisted or logged. */
  static pendingAction(reference: string, actionUrl: string, rawStatus: string | null = null, clientAction: string | null = null): PlacementOutcome {
    return new PlacementOutcome(PlacementOutcome.PENDING_ACTION, reference, null, rawStatus, actionUrl, null, null, SettlementMode.Capture, null, null, null, clientAction);
  }

  /** True even with a charge discrepancy — money moved; recording it at the wrong figure is recoverable, losing the record isn't. */
  isPlaced(): boolean {
    return this.state === PlacementOutcome.PLACED;
  }

  hasChargeDiscrepancy(): boolean {
    return this.chargeDiscrepancy !== null;
  }

  isAuthorizedOnly(): boolean {
    return this.isPlaced() && SettlementMode.isAuthorize(this.settlement);
  }
}
