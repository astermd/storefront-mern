/**
 * Ported from storefront-lamp/core/Payment/SettlementMode.php. `Capture` charges immediately;
 * `Authorize` holds funds without charging (a 3-D-Secure-style QA hold on some providers).
 */
export type SettlementModeValue = 'capture' | 'authorize';

export class SettlementMode {
  static readonly Capture: SettlementModeValue = 'capture';
  static readonly Authorize: SettlementModeValue = 'authorize';

  /** Non-string, or an unrecognised value (a typo), returns null — the caller decides the fallback, never a guessed default. */
  static parse(value: unknown): SettlementModeValue | null {
    if (typeof value !== 'string') return null;
    const normalised = value.toLowerCase().trim();
    return normalised === SettlementMode.Capture || normalised === SettlementMode.Authorize ? (normalised as SettlementModeValue) : null;
  }

  /** Authorize wins if any mode is Authorize — a cart is one order (`[13.19]`). An empty list is the safe default, Capture. */
  static strictest(...modes: SettlementModeValue[]): SettlementModeValue {
    return modes.includes(SettlementMode.Authorize) ? SettlementMode.Authorize : SettlementMode.Capture;
  }

  static isAuthorize(mode: SettlementModeValue): boolean {
    return mode === SettlementMode.Authorize;
  }
}
