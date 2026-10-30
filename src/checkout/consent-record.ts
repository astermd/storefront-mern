/** Ported from storefront-lamp/core/Checkout/ConsentRecord.php. */
export class ConsentRecord {
  constructor(
    public readonly key: string,
    public readonly granted: boolean,
    public readonly copyVersion: string,
    public readonly copyShown: string,
    public readonly at: string,
  ) {}

  toArray(): Record<string, unknown> {
    return { key: this.key, granted: this.granted, copy_version: this.copyVersion, copy_shown: this.copyShown, at: this.at };
  }

  /**
   * Rebuilds a record journey state kept, or null when what was kept is not one — for an order
   * finished in a later request than the one the buyer consented in (`[14.22]`), whose consents were
   * recorded then and are not asked for again.
   */
  static fromArray(stored: Record<string, unknown>): ConsentRecord | null {
    const key = stored.key;
    const granted = stored.granted;
    if (typeof key !== 'string' || key === '' || typeof granted !== 'boolean') return null;

    return new ConsentRecord(key, granted, String(stored.copy_version ?? ''), String(stored.copy_shown ?? ''), String(stored.at ?? ''));
  }
}
