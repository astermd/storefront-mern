/**
 * Ported from storefront-lamp/core/Checkout/FormattedAddress.php. A one-line US address split into
 * the checkout's four fields.
 *
 * The EMR's address services answer formatted strings rather than components:
 * `350 5th Avenue, New York, NY 10118-0110, USA` from the verifier, and the same without the ZIP
 * from the autofill. Reading them right to left is reliable where reading left to right is not —
 * the country, then `STATE ZIP` (or `STATE` alone), then the city are each one comma-separated
 * part, and everything before the city is the street, which may itself hold a comma
 * (`123 Main St, Suite 5`).
 *
 * The ZIP is cut to its five digits. The checkout accepts ZIP+4, but the buyer is used to typing
 * five, and a field that fills with a figure they do not recognise reads as a mistake.
 *
 * Anything that is not a US address in that shape answers null, and the caller fills nothing rather
 * than half a form.
 */
export interface ParsedAddress {
  address_line: string;
  city: string;
  territory: string;
  postal_code: string;
}

const COUNTRY = /,\s*(USA|United States)\s*$/i;
const STATE_AND_ZIP = /^([A-Z]{2})(?:\s+(\d{5})(?:-\d{4})?)?$/;

export class FormattedAddress {
  static parse(formatted: string): ParsedAddress | null {
    const trimmed = formatted.trim();

    if (!COUNTRY.test(trimmed)) return null;

    const parts = trimmed.replace(COUNTRY, '').split(',').map((part) => part.trim());
    const match = parts.length < 3 ? null : STATE_AND_ZIP.exec(parts[parts.length - 1]);
    if (match === null) return null;

    parts.pop();
    const city = parts.pop() ?? '';
    const street = parts.filter((part) => part !== '').join(', ');

    if (street === '' || city === '') return null;

    return { address_line: street, city, territory: match[1], postal_code: match[2] ?? '' };
  }

  /** Whether an autofill suggestion names a US address, judged the same way `parse()` judges it. */
  static isUnitedStates(formatted: string): boolean {
    return COUNTRY.test(formatted.trim());
  }
}
