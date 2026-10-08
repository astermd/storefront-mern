import { CardBrandValue } from './card-brand';
import { ChargeDiscrepancy } from './charge-discrepancy';
import { PaymentCredential } from './payment-credential';
import { SettlementMode, SettlementModeValue } from './settlement-mode';

/**
 * Ported from storefront-lamp/core/Payment/PlacementOutcome.php — the central result type every
 * `PaymentAdapter.place()` call returns.
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
  ) {}

  static placed(
    reference: string,
    rawStatus: string | null = null,
    discrepancy: ChargeDiscrepancy | null = null,
    reusableCredential: PaymentCredential | null = null,
    settlement: SettlementModeValue = SettlementMode.Capture,
    preAuthQa: boolean | null = null,
    providerCardBrand: CardBrandValue | null = null,
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
    );
  }

  static declined(reference: string | null, reason: string, rawStatus: string | null = null): PlacementOutcome {
    return new PlacementOutcome(PlacementOutcome.DECLINED, reference, reason, rawStatus, null);
  }

  static pendingAction(reference: string, actionUrl: string, rawStatus: string | null = null): PlacementOutcome {
    return new PlacementOutcome(PlacementOutcome.PENDING_ACTION, reference, null, rawStatus, actionUrl);
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
