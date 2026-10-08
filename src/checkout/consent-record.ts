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
}
