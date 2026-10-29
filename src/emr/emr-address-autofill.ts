import { ApiError } from '@astermd-hq/sdk';
import { FormattedAddress, ParsedAddress } from '../checkout/formatted-address';
import { OperatorLog } from '../support/operator-log';
import { AddressAutofill } from './address-autofill';
import { EmrClientFactory } from './client-factory';

const MAX_SUGGESTIONS = 5;

/**
 * Ported from storefront-lamp/core/Emr/EmrAddressAutofill.php. {@link AddressAutofill} over the
 * SDK's `verification()` resource.
 *
 * **Suggestions are not restricted to the US by the EMR**, and are biased toward wherever the
 * request comes from — which is this server, not the buyer. A partial street answers matches in
 * Australia and Nigeria alongside American ones, so only the suggestions ending in the US are kept,
 * and the buyer narrows the rest by typing on.
 *
 * **A suggestion carries no ZIP.** It is `350 5th Ave, New York, NY, USA`, and the SDK has no call
 * that resolves its place id into components. Resolving therefore asks the address verifier, whose
 * `formatted_address` does carry one — `350 5th Avenue, New York, NY 10118-0110, USA` — and reads
 * the fields out of that. The verifier's `valid` flag is deliberately ignored: it judges whether
 * the address is complete enough to deliver to, which a street address with no apartment can fail
 * while still being exactly the address chosen. When the verifier cannot answer, the suggestion's
 * own text is read instead, which fills everything but the ZIP.
 *
 * Failures are info lines that name the call and never the address, for the reasons
 * `EmrVerificationGateway` gives: an outage here is a missing convenience, and an API error can
 * quote its input.
 */
export class EmrAddressAutofill implements AddressAutofill {
  constructor(
    private readonly clients: EmrClientFactory,
    private readonly log: OperatorLog,
  ) {}

  async suggest(search: string): Promise<Array<{ address: string; main_text: string }> | null> {
    let data: unknown;
    try {
      data = (await this.clients.create().verification().autofillAddress(search)).data();
    } catch (e) {
      this.unavailable('autofill', e);
      return null;
    }

    const suggestions: Array<{ address: string; main_text: string }> = [];

    for (const item of Array.isArray(data) ? data : Object.values((data ?? {}) as Record<string, unknown>)) {
      const record = item !== null && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      const address = record.address;

      if (typeof address !== 'string' || !FormattedAddress.isUnitedStates(address)) continue;

      const main = record.main_text;
      suggestions.push({
        address: address.trim(),
        main_text: typeof main === 'string' && main.trim() !== '' ? main.trim() : address.trim(),
      });

      if (suggestions.length === MAX_SUGGESTIONS) break;
    }

    return suggestions;
  }

  async resolve(address: string): Promise<ParsedAddress | null> {
    let formatted: unknown = null;
    try {
      formatted = ((await this.clients.create().verification().verifyAddress(address)).data() as Record<string, unknown>).formatted_address ?? null;
    } catch (e) {
      this.unavailable('verify', e);
    }

    return (typeof formatted === 'string' ? FormattedAddress.parse(formatted) : null) ?? FormattedAddress.parse(address);
  }

  /** Records a lookup that could not run, naming which one and why, and never what was looked up. */
  private unavailable(call: string, e: unknown): void {
    this.log.info('address_autofill.unavailable', {
      call,
      exception: (e as Error).constructor.name,
      status: e instanceof ApiError ? e.statusCode() : null,
    });
  }
}
