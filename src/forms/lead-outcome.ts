/**
 * Ported from storefront-lamp/core/Forms/LeadOutcome.php. The result of one `LeadWriter.capture()`
 * call — whether a *new* opportunity was created this call, and whichever id (new or existing) the
 * lead now has.
 */
export class LeadOutcome {
  private constructor(
    private readonly createdFlag: boolean,
    private readonly opportunityIdValue: string | null,
  ) {}

  static createdLead(opportunityId: string): LeadOutcome {
    return new LeadOutcome(true, opportunityId);
  }

  static noneCreated(opportunityId: string | null = null): LeadOutcome {
    return new LeadOutcome(false, opportunityId);
  }

  created(): boolean {
    return this.createdFlag;
  }

  opportunityId(): string | null {
    return this.opportunityIdValue;
  }
}
