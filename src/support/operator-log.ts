import { appendFileSync } from 'node:fs';

/**
 * Ported from storefront-lamp/core/Support/OperatorLog.php. Appends one redacted JSON line per
 * event to the operator log.
 *
 * The storefront degrades silently by design — a failed analytics call must never reach the
 * visitor (`[20.1]`) — so this log is the only place those failures become visible, and writing
 * to it must itself never fail: an unwritable file is swallowed rather than turned into the error
 * it was trying to record. Context is redacted on the way in (`[20.6]`), because a log that echoes
 * an order or an intake answer is a personal-data leak onto disk.
 *
 * Value-based scrubbing (`CardScrubber`, for card data hiding inside a string whose key means
 * nothing to us) and correlation-id stamping (`CorrelationContext`) are later phases' additions —
 * this port carries the key-based redaction pass now since it needs nothing else to be correct.
 */
export class OperatorLog {
  /**
   * Context keys whose values never reach disk, matched case-insensitively. Anything health-,
   * identity-, card- or credential-shaped belongs here; ids, paths, counts and outcome codes are
   * what a log is for. Ported verbatim from storefront-lamp's REDACTED_KEYS.
   */
  private static readonly REDACTED_KEYS = new Set([
    'first_name', 'last_name', 'name', 'full_name', 'email', 'phone', 'address', 'address_line',
    'address_line_1', 'address_line_2', 'city', 'postal_code', 'zip', 'dob', 'date_of_birth',
    'ssn', 'card_number', 'card', 'cvv', 'exp_month', 'exp_year', 'password', 'api_key',
    'client_secret', 'access_token', 'answers', 'payload', '_amd',
    'number', 'security_code', 'expiry_month', 'expiry_year',
    'card_cvc', 'card_expiry',
    'card_cvv', 'card_exp_month', 'card_exp_year',
    'buyer_email', 'buyer_name',
    'bill_fname', 'bill_lname', 'bill_address1', 'bill_address2', 'bill_city', 'bill_zipcode',
    'ship_fname', 'ship_lname', 'ship_address1', 'ship_address2', 'ship_city', 'ship_zipcode',
    'handle', 'customer_id', 'customer_card_id',
  ]); // prettier-ignore

  constructor(private readonly logFile: string) {}

  info(event: string, context: Record<string, unknown> = {}): void {
    this.write('info', event, context);
  }

  warning(event: string, context: Record<string, unknown> = {}): void {
    this.write('warning', event, context);
  }

  error(event: string, context: Record<string, unknown> = {}): void {
    this.write('error', event, context);
  }

  /** Replaces the value of every redacted key with a marker, recursing into nested objects. */
  static redact(context: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(context)) {
      if (OperatorLog.REDACTED_KEYS.has(key.toLowerCase())) {
        out[key] = '[redacted]';
        continue;
      }
      out[key] =
        value && typeof value === 'object' && !Array.isArray(value)
          ? OperatorLog.redact(value as Record<string, unknown>)
          : value;
    }
    return out;
  }

  private write(level: string, event: string, context: Record<string, unknown>): void {
    const envelope = {
      ts: new Date().toISOString(),
      level,
      event,
      context: OperatorLog.redact(context),
    };

    let line: string;
    try {
      line = JSON.stringify(envelope);
    } catch {
      line = JSON.stringify({
        ts: envelope.ts,
        level,
        event,
        context: { error: 'context could not be encoded' },
      });
    }

    try {
      appendFileSync(this.logFile, line + '\n');
    } catch {
      // Writing to the operator log must never itself fail loudly — see class doc comment.
    }
  }
}
