import type { TreatmentSyncOptions } from '@astermd-hq/sdk';

/**
 * `treatments().sync()` options as PHP astermd/sdk 0.0.3 defines them: the installed JS SDK's
 * {@link TreatmentSyncOptions} plus `payment` and `verification`.
 *
 * **The installed `@astermd-hq/sdk` 0.0.2 drops these two fields** — its typings do not declare
 * them and its implementation does not serialise them, so against 0.0.2 they type-check here but
 * never reach the EMR. A JS release matching PHP 0.0.3 is required before they take effect; this
 * port assumes that release accepts them with the same shape and does not bypass the SDK with raw
 * HTTP. This is the one place the extension lives — delete it when the SDK's own type has them.
 */
export type ExtendedTreatmentSyncOptions = TreatmentSyncOptions & {
  /** `PaymentDescriptor.toArray()`; omitted when no descriptor exists. */
  payment?: Record<string, unknown>;
  /** What was actually verified about the buyer; omitted when nothing was. */
  verification?: VerificationBlock;
};

/** The treatments-sync `verification` block: what was verified about the buyer. */
export interface VerificationBlock {
  email: boolean;
  address: boolean;
  /** The identity check's outcome; present only when a decisive check ran. */
  id?: { verified: boolean | null; method: 'ssn' | 'dob' | 'cross_check' | 'document_upload'; value?: string };
}
