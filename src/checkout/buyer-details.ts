import { BillingAddress } from '../payment/billing-address';
import { Buyer } from '../payment/buyer';

/** checkout field name -> property name, canonicalized once so 5 downstream readers never disagree. */
const FIELDS: Record<string, keyof BuyerAddressFields> = {
  first_name: 'firstName',
  last_name: 'lastName',
  email: 'email',
  phone: 'phone',
  address_line: 'addressLine',
  city: 'city',
  territory: 'territory',
  postal_code: 'postalCode',
};

/** Billing field name -> the property it fills; read only when the box is ticked. */
const BILLING_FIELDS: Record<string, keyof BuyerAddressFields> = {
  billing_first_name: 'billingFirstName',
  billing_last_name: 'billingLastName',
  billing_address_line: 'billingAddressLine',
  billing_city: 'billingCity',
  billing_territory: 'billingTerritory',
  billing_postal_code: 'billingPostalCode',
};

interface BuyerAddressFields {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  addressLine: string;
  city: string;
  territory: string;
  postalCode: string;
  billingFirstName: string;
  billingLastName: string;
  billingAddressLine: string;
  billingCity: string;
  billingTerritory: string;
  billingPostalCode: string;
}

export interface BuyerDetailsFields extends BuyerAddressFields {
  billingDifferent: boolean;
}

/**
 * Canonicalizing phone/territory once
 * here is what makes 5 downstream readers (validator, idempotency key, stored state, provider,
 * template) never disagree.
 *
 * Billing is shipping (`[13.2]`) unless the buyer ticks "Use a different billing address", and only
 * then are the `billing_*` fields read. The fields stay in the form while hidden, so reading them
 * unticked would bill a card to an address the buyer can no longer see.
 */
export class BuyerDetails implements BuyerDetailsFields {
  /** The value the "Use a different billing address" checkbox posts. */
  static readonly BILLING_DIFFERENT = 'on';

  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone: string;
  readonly addressLine: string;
  readonly city: string;
  readonly territory: string;
  readonly postalCode: string;
  readonly billingDifferent: boolean;
  readonly billingFirstName: string;
  readonly billingLastName: string;
  readonly billingAddressLine: string;
  readonly billingCity: string;
  readonly billingTerritory: string;
  readonly billingPostalCode: string;

  constructor(fields: Partial<BuyerDetailsFields> = {}) {
    this.firstName = fields.firstName ?? '';
    this.lastName = fields.lastName ?? '';
    this.email = fields.email ?? '';
    this.phone = fields.phone ?? '';
    this.addressLine = fields.addressLine ?? '';
    this.city = fields.city ?? '';
    this.territory = fields.territory ?? '';
    this.postalCode = fields.postalCode ?? '';
    this.billingDifferent = fields.billingDifferent ?? false;
    this.billingFirstName = fields.billingFirstName ?? '';
    this.billingLastName = fields.billingLastName ?? '';
    this.billingAddressLine = fields.billingAddressLine ?? '';
    this.billingCity = fields.billingCity ?? '';
    this.billingTerritory = fields.billingTerritory ?? '';
    this.billingPostalCode = fields.billingPostalCode ?? '';
  }

  /**
   * Reads the 8 checkout field keys, plus the 6 billing keys only when `billing_different` is
   * ticked; a missing key is `''`, never absent. Phone reduced to digits; territories uppercased;
   * everything else trimmed.
   */
  static fromSubmitted(body: Record<string, unknown>): BuyerDetails {
    const fields: Partial<BuyerDetailsFields> = {};

    for (const [checkoutField, property] of Object.entries(FIELDS)) {
      const value = BuyerDetails.text(body[checkoutField]);

      if (property === 'phone') {
        fields[property] = value.replace(/\D+/g, '');
      } else if (property === 'territory') {
        fields[property] = value.toUpperCase();
      } else {
        fields[property] = value;
      }
    }

    const billingDifferent = BuyerDetails.text(body.billing_different) === BuyerDetails.BILLING_DIFFERENT;
    fields.billingDifferent = billingDifferent;
    for (const [checkoutField, property] of Object.entries(BILLING_FIELDS)) {
      const value = billingDifferent ? BuyerDetails.text(body[checkoutField]) : '';
      fields[property] = property === 'billingTerritory' ? value.toUpperCase() : value;
    }

    return new BuyerDetails(fields);
  }

  /**
   * The journey's stored field set, read back. The inverse of {@link toArray}; a set stored before
   * a billing address could be given reads as "billed to the delivery address".
   */
  static fromStored(stored: Record<string, string>): BuyerDetails {
    const fields: Partial<BuyerDetailsFields> = {};
    for (const [checkoutField, property] of Object.entries({ ...FIELDS, ...BILLING_FIELDS })) {
      fields[property] = stored[checkoutField] ?? '';
    }
    fields.billingDifferent = (stored.billing_different ?? '') === BuyerDetails.BILLING_DIFFERENT;

    return new BuyerDetails(fields);
  }

  /**
   * Canonical field-keyed array — the same keys `Prefill.from()` produces.
   *
   * The billing keys are present only when ticked, so an unticked buyer's set — and with it the
   * idempotency key derived from it (`[13.37]`) — is exactly what it was before a billing address
   * could be given.
   */
  toArray(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [checkoutField, property] of Object.entries(FIELDS)) {
      out[checkoutField] = this[property];
    }

    if (this.billingDifferent) {
      out.billing_different = BuyerDetails.BILLING_DIFFERENT;
      for (const [checkoutField, property] of Object.entries(BILLING_FIELDS)) {
        out[checkoutField] = this[property];
      }
    }

    return out;
  }

  toBuyer(): Buyer {
    return new Buyer(
      this.firstName,
      this.lastName,
      this.email,
      this.phone,
      this.addressLine,
      this.city,
      this.territory,
      this.postalCode,
      'US',
      this.billingDifferent
        ? new BillingAddress(this.billingFirstName, this.billingLastName, this.billingAddressLine, this.billingCity, this.billingTerritory, this.billingPostalCode)
        : null,
    );
  }

  private static text(raw: unknown): string {
    return typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' ? String(raw).trim() : '';
  }
}
