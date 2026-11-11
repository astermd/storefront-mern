import { BillingAddress } from './billing-address';

/**
 * Ported from storefront-lamp/core/Payment/Buyer.php. The buyer as the provider needs them
 * (`[13.1]`).
 *
 * Billing is taken to be the shipping address (`[13.2]`) unless `billing` says otherwise: it is set
 * only when the buyer asked to be billed elsewhere, and a provider that wants both addresses
 * receives the delivery address twice when it is null, which is the adapter's business, not the
 * funnel's. Country is hardcoded US — declared gap `[13.36]`.
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
    public readonly billing: BillingAddress | null = null,
  ) {}
}
