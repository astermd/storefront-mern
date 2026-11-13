/**
 * The address the card is billed to,
 * when the buyer gave one apart from the delivery address.
 *
 * Billing defaults to shipping (`[13.2]`), so a {@link Buyer} carries one of these only when the
 * buyer ticked "Use a different billing address". Its absence means "bill the delivery address",
 * never "no billing address".
 */
export class BillingAddress {
  constructor(
    public readonly firstName: string,
    public readonly lastName: string,
    public readonly addressLine: string,
    public readonly city: string,
    public readonly territory: string,
    public readonly postalCode: string,
    public readonly country: string = 'US',
  ) {}

  fullName(): string {
    return `${this.firstName} ${this.lastName}`.trim();
  }
}
