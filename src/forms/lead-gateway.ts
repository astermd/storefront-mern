/**
 * Ported from storefront-lamp/core/Forms/LeadGateway.php. The storefront's view of the EMR's
 * opportunity (lead) resource.
 */
export interface LeadGateway {
  /** @param payload the `opportunity`-rooted record, as `RecordMapper` builds it */
  create(payload: Record<string, unknown>): Promise<string | null>;

  /** @param payload the record rebuilt in full (`[11.5]`), not a delta */
  update(opportunityId: string, payload: Record<string, unknown>): Promise<boolean>;

  /** Whether this gateway writes anywhere at all. */
  writes(): boolean;
}
