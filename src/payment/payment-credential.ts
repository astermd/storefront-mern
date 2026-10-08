import { inspect } from 'node:util';

/**
 * Ported from storefront-lamp/core/Payment/PaymentCredential.php. What checkout hands the payment
 * adapter — one of four kinds, only one of which (`card`) ever carries a raw number, and that
 * number is structurally forbidden from ever being persisted (`[15.8]`, `[15.12]`).
 *
 * PHP's magic-method redaction (`__serialize`/`jsonSerialize`/`__debugInfo`, each returning
 * `{kind, number:'[REDACTED]', handle:'[REDACTED]'}`, and `__unserialize` refusing unconditionally)
 * has two direct Node equivalents ported here: `toJSON()` (what `JSON.stringify` calls) and
 * `[util.inspect.custom]` (what `console.log`/Node's own inspector calls). There is no Node
 * equivalent of PHP's `unserialize` to refuse — nothing in this codebase deserializes an arbitrary
 * object into a class instance the way PHP's `unserialize()` can, so the risk it guards against
 * doesn't exist here the same way.
 */
export class PaymentCredential {
  static readonly KIND_CARD = 'card';
  static readonly KIND_TOKEN = 'token';
  static readonly KIND_ORDER_REFERENCE = 'order_reference';
  static readonly KIND_STORED_INSTRUMENT = 'stored_instrument';

  private constructor(
    public readonly kind: string,
    public readonly number: string | null,
    public readonly expiryMonth: string | null,
    public readonly expiryYear: string | null,
    public readonly securityCode: string | null,
    public readonly reference: string | null,
    public readonly handle: Record<string, string> | null,
  ) {}

  static card(number: string, expiryMonth: string, expiryYear: string, securityCode: string): PaymentCredential {
    return new PaymentCredential(PaymentCredential.KIND_CARD, number.replace(/\D/g, ''), expiryMonth, expiryYear, securityCode, null, null);
  }

  static token(reference: string): PaymentCredential {
    return new PaymentCredential(PaymentCredential.KIND_TOKEN, null, null, null, null, reference, null);
  }

  static orderReference(reference: string): PaymentCredential {
    return new PaymentCredential(PaymentCredential.KIND_ORDER_REFERENCE, null, null, null, null, reference, null);
  }

  /** Coerces every key/value to a string — an "opaque" pair (e.g. customer + card id for one provider). */
  static stored(handle: Record<string, unknown>): PaymentCredential {
    const coerced: Record<string, string> = {};
    for (const [key, value] of Object.entries(handle)) {
      coerced[String(key)] = String(value);
    }
    return new PaymentCredential(PaymentCredential.KIND_STORED_INSTRUMENT, null, null, null, null, null, coerced);
  }

  /** Only non-empty for `KIND_CARD`. */
  lastFour(): string {
    if (this.kind !== PaymentCredential.KIND_CARD || this.number === null) return '';
    return this.number.slice(-4);
  }

  isReusable(): boolean {
    return this.kind === PaymentCredential.KIND_STORED_INSTRUMENT && this.handle !== null && Object.keys(this.handle).length > 0;
  }

  /** Throws for `KIND_CARD` — a structural guarantee a card can never be persisted. */
  toStorable(): { kind: string; handle: Record<string, string> } {
    if (this.kind === PaymentCredential.KIND_CARD) {
      throw new Error('A card credential may never be persisted.');
    }
    return { kind: this.kind, handle: this.handle ?? {} };
  }

  /** Only reconstructs `KIND_STORED_INSTRUMENT` — a stored `KIND_CARD` (which should never exist) is refused too, not honoured. */
  static fromStorable(stored: { kind: string; handle: Record<string, string> }): PaymentCredential | null {
    if (stored.kind !== PaymentCredential.KIND_STORED_INSTRUMENT) return null;
    return PaymentCredential.stored(stored.handle);
  }

  toJSON(): Record<string, string> {
    return { kind: this.kind, number: '[REDACTED]', handle: '[REDACTED]' };
  }

  [inspect.custom](): Record<string, string> {
    return this.toJSON();
  }
}
