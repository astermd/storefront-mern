import { Buyer } from '../payment/buyer';

/** checkout field name -> property name, canonicalized once so 5 downstream readers never disagree. */
const FIELDS: Record<string, keyof BuyerDetailsFields> = {
  first_name: 'firstName',
  last_name: 'lastName',
  email: 'email',
  phone: 'phone',
  address_line: 'addressLine',
  city: 'city',
  territory: 'territory',
  postal_code: 'postalCode',
};

interface BuyerDetailsFields {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  addressLine: string;
  city: string;
  territory: string;
  postalCode: string;
}

/**
 * Ported from storefront-lamp/core/Checkout/BuyerDetails.php. Canonicalizing phone/territory once
 * here is what makes 5 downstream readers (validator, idempotency key, stored state, provider,
 * template) never disagree.
 */
export class BuyerDetails implements BuyerDetailsFields {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone: string;
  readonly addressLine: string;
  readonly city: string;
  readonly territory: string;
  readonly postalCode: string;

  constructor(fields: Partial<BuyerDetailsFields> = {}) {
    this.firstName = fields.firstName ?? '';
    this.lastName = fields.lastName ?? '';
    this.email = fields.email ?? '';
    this.phone = fields.phone ?? '';
    this.addressLine = fields.addressLine ?? '';
    this.city = fields.city ?? '';
    this.territory = fields.territory ?? '';
    this.postalCode = fields.postalCode ?? '';
  }

  /** Reads only the 8 checkout field keys; a missing key is `''`, never absent. Phone reduced to digits; territory uppercased; everything else trimmed. */
  static fromSubmitted(body: Record<string, unknown>): BuyerDetails {
    const fields: Partial<BuyerDetailsFields> = {};

    for (const [checkoutField, property] of Object.entries(FIELDS)) {
      const raw = body[checkoutField];
      const value = typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' ? String(raw).trim() : '';

      if (property === 'phone') {
        fields[property] = value.replace(/\D+/g, '');
      } else if (property === 'territory') {
        fields[property] = value.toUpperCase();
      } else {
        fields[property] = value;
      }
    }

    return new BuyerDetails(fields);
  }

  /** Canonical field-keyed array — the same keys `Prefill.from()` produces. */
  toArray(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [checkoutField, property] of Object.entries(FIELDS)) {
      out[checkoutField] = this[property];
    }
    return out;
  }

  toBuyer(): Buyer {
    return new Buyer(this.firstName, this.lastName, this.email, this.phone, this.addressLine, this.city, this.territory, this.postalCode);
  }
}
