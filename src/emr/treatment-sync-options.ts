import type { TreatmentCardOptions, TreatmentPaymentOptions, TreatmentVerificationOptions } from '@astermd-hq/sdk';

/**
 * `treatments().sync()` options. `@astermd-hq/sdk` 0.0.4 declares `payment` and `verification`
 * itself, and serialises them: it reads `payment` in camelCase (`preAuth`, `preAuthQa`,
 * `preAuthAmount`) and writes the snake_case wire body, and it passes `card` and `verification.id`
 * through verbatim. {@link toSyncPayment} is the one place the storefront's stored `toArray()` form
 * becomes the SDK's shape.
 *
 * The treatments-sync `verification` block: what was verified about the buyer. It is wider than the
 * SDK's own type in one place: an uploaded ID document nobody has reviewed is reported with
 * `verified: null`, which the SDK sends as given but types as a boolean.
 */
export interface VerificationBlock {
  email: boolean;
  address: boolean;
  /** The identity check's outcome; present only when a decisive check ran. */
  id?: { verified: boolean | null; method: 'ssn' | 'dob' | 'cross_check' | 'document_upload'; value?: string };
}

/** The block as the SDK's own type, for the call itself; `verified: null` reaches the wire unchanged. */
export function toSdkVerification(block: VerificationBlock): TreatmentVerificationOptions {
  return block as TreatmentVerificationOptions;
}

/**
 * `PaymentDescriptor.toArray()` — live, or as stored on the journey for the receipt-time sync — as
 * the SDK's {@link TreatmentPaymentOptions}. Keys the descriptor omits stay omitted. A stored card
 * written before the `last_4` rename still carries `last4`, so both are read.
 */
export function toSyncPayment(stored: Record<string, unknown>): TreatmentPaymentOptions {
  const payment: TreatmentPaymentOptions = {
    type: stored.type as TreatmentPaymentOptions['type'],
    preAuth: stored.pre_auth === true,
  };

  if (stored.pre_auth_qa === true) payment.preAuthQa = true;
  if (typeof stored.pre_auth_amount === 'number') payment.preAuthAmount = stored.pre_auth_amount;

  const card = stored.card;
  if (card !== null && typeof card === 'object') {
    const source = card as Record<string, unknown>;
    const lastFour = source.last_4 ?? source.last4;
    // `type` is omitted, never guessed, when the brand was not derivable — see CardDescriptor.
    const out: Record<string, unknown> = {};
    if (typeof source.type === 'string') out.type = source.type;
    if (typeof lastFour === 'string') out.last_4 = lastFour;
    if (typeof source.exp === 'string') out.exp = source.exp;
    payment.card = out as unknown as TreatmentCardOptions;
  }

  return payment;
}
