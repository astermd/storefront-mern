import { ParsedAddress } from '../checkout/formatted-address';

/**
 * Ported from storefront-lamp/core/Emr/AddressAutofill.php. Address suggestions for the checkout's
 * address field, from the EMR.
 *
 * This is the fallback source. A deployment that configures its own Google Maps key is served
 * suggestions by Google in the browser and never reaches this port; one that does not is served
 * from here, through the storefront's own endpoint, so the EMR credential never reaches the page.
 *
 * A port of its own rather than two more methods on `VerificationGateway` because the two are
 * switched independently: verification at checkout is off by default, autocomplete is on, and a
 * deployment can want either without the other.
 *
 * **Null means "could not ask", and never blocks anything.** Autocomplete is a convenience over
 * fields the buyer can always type; an outage leaves them typing, which is where they started.
 */
export interface AddressAutofill {
  /** Up to five US suggestions for a partial address, or null when the lookup could not run. */
  suggest(search: string): Promise<Array<{ address: string; main_text: string }> | null>;

  /** The checkout fields for one suggestion's address text. */
  resolve(address: string): Promise<ParsedAddress | null>;
}
