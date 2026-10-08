/**
 * Ported from storefront-lamp/core/Payment/Buyer.php. One address only (billing = shipping,
 * `[13.2]`). Country is hardcoded US — declared gap `[13.36]`.
 */
export class Buyer {
  constructor(
    public readonly firstName: string,
    public readonly lastName: string,
    public readonly email: string,
    public readonly phone: string,
    public readonly addressLine: string,
    public readonly city: string,
    public readonly territory: string,
    public readonly postalCode: string,
    public readonly country: string = 'US',
  ) {}
}
