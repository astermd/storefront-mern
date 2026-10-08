import { VerificationGateway } from '../emr/verification-gateway';
import { BuyerDetails } from './buyer-details';

/**
 * Ported from storefront-lamp/core/Checkout/BuyerValidator.php. The server's answer on whether a
 * submitted checkout form can become an order (`[13.5]`).
 *
 * **The gateway is a parameter, not a constructor dependency.** The EMR-backed email check is a
 * capability this deployment may not have; when the check cannot be run it returns null, and null
 * never produces an error — a third-party outage must not stop a legitimate order (`[20.1]`). Every
 * rule here stands on its own without the EMR ever answering.
 */
export class BuyerValidator {
  /** Deliberately looser than a strict RFC email regex, matching `AnswerValidator`'s shape — an address the intake accepted must not be refused here (`[28.3]`). */
  private static readonly EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /** A US ZIP, five digits with an optional +4 (`[13.1]`). */
  private static readonly POSTAL_SHAPE = /^\d{5}(-\d{4})?$/;

  private static readonly PHONE_DIGITS = 10;

  /** Every territory this storefront ships to: fifty states, DC, and five inhabited territories (`[13.36]` is a declared US-only gap, made visible rather than silently accepting any two letters). */
  private static readonly TERRITORIES = [
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL',
    'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME',
    'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH',
    'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI',
    'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI',
    'WY', 'AS', 'GU', 'MP', 'PR', 'VI',
  ]; // prettier-ignore

  /**
   * Every problem with this submission, keyed by the checkout field that has it. At most one
   * message per field — a blank email is not also badly shaped, it is blank.
   */
  static async validate(details: BuyerDetails, verification: VerificationGateway): Promise<Record<string, string>> {
    const errors: Record<string, string> = { ...BuyerValidator.required(details) };

    if (errors.email === undefined && !BuyerValidator.EMAIL_SHAPE.test(details.email)) {
      errors.email = 'Enter an email address in the form name@example.com.';
    }

    if (errors.phone === undefined && details.phone.length < BuyerValidator.PHONE_DIGITS) {
      errors.phone = 'Enter a phone number with at least 10 digits, including the area code.';
    }

    if (errors.territory === undefined) {
      const territoryError = BuyerValidator.territoryError(details.territory);
      if (territoryError !== null) errors.territory = territoryError;
    }

    if (errors.postal_code === undefined && !BuyerValidator.POSTAL_SHAPE.test(details.postalCode)) {
      errors.postal_code = 'Enter a ZIP code as five digits, or five plus four.';
    }

    // Only once the address is locally well-formed, and only when the capability is actually
    // granted: a check that cannot run must not cost every buyer a round trip on every render.
    if (errors.email === undefined && verification.isEnabled() && (await verification.emailIsDeliverable(details.email)) === false) {
      errors.email = 'We could not deliver mail to that address. Check it for a typo.';
    }

    return errors;
  }

  /** Whitespace is not an answer: `BuyerDetails.fromSubmitted()` has already trimmed, so a box holding only spaces arrives here empty. */
  private static required(details: BuyerDetails): Record<string, string> {
    const messages: Record<string, string> = {
      first_name: 'Enter your first name.',
      last_name: 'Enter your last name.',
      email: 'Enter your email address.',
      phone: 'Enter your phone number.',
      address_line: 'Enter your street address.',
      city: 'Enter your city.',
      territory: 'Choose your state.',
      postal_code: 'Enter your ZIP code.',
    };

    const missing: Record<string, string> = {};
    for (const [field, value] of Object.entries(details.toArray())) {
      if (value === '' && messages[field] !== undefined) {
        missing[field] = messages[field];
      }
    }

    return missing;
  }

  private static territoryError(territory: string): string | null {
    if (!/^[A-Z]{2}$/.test(territory)) {
      return 'Enter your state as its two-letter code, such as NY.';
    }

    if (!BuyerValidator.TERRITORIES.includes(territory)) {
      return 'We ship within the United States only, so this must be a US state or territory.';
    }

    return null;
  }
}
