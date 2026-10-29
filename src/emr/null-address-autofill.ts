import { ParsedAddress } from '../checkout/formatted-address';
import { AddressAutofill } from './address-autofill';

/**
 * Ported from storefront-lamp/core/Emr/NullAddressAutofill.php. The port bound when
 * `features.addressAutofill` is off — always the case under the test suite, whose runs must never
 * reach the network.
 *
 * It answers "could not ask" to everything, which is what the live one answers in an outage, so the
 * checkout behaves the same either way: the buyer types the address.
 */
export class NullAddressAutofill implements AddressAutofill {
  async suggest(): Promise<Array<{ address: string; main_text: string }> | null> {
    return null;
  }

  async resolve(): Promise<ParsedAddress | null> {
    return null;
  }
}
