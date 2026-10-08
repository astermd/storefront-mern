/**
 * Ported from storefront-lamp/core/Support/CardScrubber.php. Masks card data inside foreign data,
 * whatever key it arrived under and wherever inside a string it sits.
 *
 * This is the second of two defences and does not replace the first. `OperatorLog.redact()` is
 * key-based: it knows the names our own structures use and blanks those values whole, which is
 * exactly right for data we shaped and useless for data we did not. A payment provider echoing
 * `gateway_request_text` returns one opaque string with a PAN somewhere in the middle of it, under
 * a key no redaction list would ever think to name. Nothing key-based can see inside that string.
 *
 * So this pass looks at values instead of keys, in two sweeps:
 *
 * 1. **The security code and the expiry.** Neither is Luhn-checkable, so nothing below can find
 *    them by shape; they are found by the key they sit next to *inside* the string
 *    (`cvv=737`, `ccexp=1230`).
 * 2. **The number.** Every 13-19 digit run that passes a Luhn check is replaced, separators and
 *    all. Luhn is what keeps ordinary identifiers out of the match — an order id, a transaction
 *    id, a timestamp. One identifier shape a single check digit is too weak to protect (a UUID) is
 *    exempted by shape instead.
 *
 * **Strings and arrays only, and values only.** Keys are left alone, and numbers are left alone
 * (every recorded provider envelope carries card numbers as strings; numeric identifiers arrive as
 * numbers — matching those would trade a leak never seen for a log that can't be read).
 */
export class CardScrubber {
  /** Replacement written in place of anything that looks like card data. */
  static readonly MASK = '[redacted-card]';

  /**
   * Replacement for a string the regex engine could not finish scanning. Dropping it whole is the
   * safe direction; losing one log value costs an operator context, keeping it can cost a card
   * number.
   */
  static readonly UNSCANNABLE = '[redacted: could not be scanned]';

  /** Shortest and longest PAN any scheme issues: 13 (old Visa) to 19 (co-branded Visa). */
  private static readonly PAN_MIN_DIGITS = 13;
  private static readonly PAN_MAX_DIGITS = 19;

  /** A run of digits held together by single spaces, dashes or dots. */
  private static readonly DIGIT_RUN = /[0-9](?:[ \-.]?[0-9])*/g;

  /**
   * A uuid in its canonical 8-4-4-4-12 form, which no card number takes. Exempted by shape: a PAN
   * is a run of digits of any length 13-19 in whatever grouping the writer chose; a uuid is a
   * fixed five-group hex string of exactly 8-4-4-4-12 characters.
   */
  private static readonly UUID = /(?<![0-9A-Za-z-])[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}(?![0-9A-Za-z-])/g;

  /**
   * The security code and the expiry, named by the key they sit beside. The value bound is a
   * whitelist of the forms these two data actually travel in: one to four digits, exactly six, or
   * two parts joined by `/`, `-` or `.`.
   */
  private static readonly SENSITIVE_PAIR =
    /(?<![A-Za-z0-9_])(cvv2?|cvc2?|cid|card_cvv|card_cvc|security_code|ccexp|exp|expiry|expiration|exp_month|exp_year|card_exp_month|card_exp_year|card_expiry|card_expiration)(["']?\s*[:=]\s*["']?)((?:[0-9]{1,4}\s*[/\-.]\s*[0-9]{2,4})|[0-9]{6}|[0-9]{1,4})(?![0-9])/gi;

  /** The same value with every piece of card data masked. Recurses into arrays and plain objects, preserving keys. */
  static scrub(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => CardScrubber.scrub(item));
    }

    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        out[key] = CardScrubber.scrub(item);
      }
      return out;
    }

    if (typeof value !== 'string') {
      return value;
    }

    let withoutCodes: string;
    try {
      withoutCodes = value.replace(CardScrubber.SENSITIVE_PAIR, (_match, key: string, sep: string) => key + sep + CardScrubber.MASK);
    } catch {
      return CardScrubber.UNSCANNABLE;
    }

    return CardScrubber.maskCardNumbers(withoutCodes);
  }

  /** A convenience for sinks that have a record in hand and need one back. */
  static scrubRecord(value: Record<string, unknown>): Record<string, unknown> {
    return CardScrubber.scrub(value) as Record<string, unknown>;
  }

  /**
   * Masks every card-number-shaped window inside a string. A digit run is decomposed into its
   * unbroken digit groups, and every contiguous span of groups totalling 13-19 digits is
   * Luhn-tested, longest first, so a 16-digit number is still found inside `PAN SP CVV`. Spans are
   * tested at group boundaries and never inside a group, so a 20-digit identifier stays whole.
   */
  private static maskCardNumbers(value: string): string {
    let runs: RegExpMatchArray[];
    try {
      runs = [...value.matchAll(CardScrubber.DIGIT_RUN)];
    } catch {
      return CardScrubber.UNSCANNABLE;
    }

    const exempt = CardScrubber.uuidRanges(value);
    if (exempt === null) return CardScrubber.UNSCANNABLE;

    const spans: Array<[number, number]> = [];

    for (const run of runs) {
      const runOffset = run.index ?? 0;
      for (const [start, length] of CardScrubber.maskedSpansIn(run[0], runOffset, exempt)) {
        spans.push([runOffset + start, length]);
      }
    }

    if (spans.length === 0) return value;

    // Built in one pass rather than by repeated splicing.
    spans.sort((a, b) => a[0] - b[0]);

    let out = '';
    let cursor = 0;
    for (const [start, length] of spans) {
      out += value.slice(cursor, start) + CardScrubber.MASK;
      cursor = start + length;
    }

    return out + value.slice(cursor);
  }

  /**
   * The `[offset, length]` spans of one digit run that are card numbers. Guaranteed not to
   * overlap: once a span is claimed, no later span may reuse any of its groups, so the longest
   * Luhn-valid reading of the run wins and the rest of the run stays readable.
   *
   * @param exempt half-open `[start, end)` ranges (absolute, in the whole value) no span may enter
   */
  private static maskedSpansIn(run: string, runOffset: number, exempt: Array<[number, number]>): Array<[number, number]> {
    let groupMatches: RegExpMatchArray[];
    try {
      groupMatches = [...run.matchAll(/[0-9]+/g)];
    } catch {
      return [];
    }

    const groups = groupMatches.map((m) => ({ text: m[0], offset: m.index ?? 0 }));
    const count = groups.length;

    // Which groups sit inside a uuid, resolved once. A group is held back whole or not at all.
    const held = new Set<number>();
    for (let index = 0; index < count; index++) {
      const start = runOffset + groups[index].offset;
      const end = start + groups[index].text.length;
      for (const [from, to] of exempt) {
        if (start >= from && end <= to) {
          held.add(index);
          break;
        }
      }
    }

    // Every contiguous span of groups whose combined digit count could be a PAN, bucketed by that
    // count — bucketing is what keeps this linear in the length of the run.
    const candidates = new Map<number, Array<[number, number, string]>>();
    for (let len = CardScrubber.PAN_MIN_DIGITS; len <= CardScrubber.PAN_MAX_DIGITS; len++) candidates.set(len, []);

    for (let first = 0; first < count; first++) {
      if (held.has(first)) continue;

      let digits = '';
      for (let last = first; last < count; last++) {
        if (held.has(last)) break;

        digits += groups[last].text;
        const length = digits.length;

        if (length > CardScrubber.PAN_MAX_DIGITS) break;
        if (length >= CardScrubber.PAN_MIN_DIGITS) {
          candidates.get(length)!.push([first, last, digits]);
        }
      }
    }

    // Longest first, then leftmost, so `PAN SP CVV` reads as the PAN rather than as two unrelated
    // fragments of it.
    const spans: Array<[number, number]> = [];
    const claimed = new Set<number>();

    for (let length = CardScrubber.PAN_MAX_DIGITS; length >= CardScrubber.PAN_MIN_DIGITS; length--) {
      for (const [first, last, digits] of candidates.get(length)!) {
        if (CardScrubber.anyClaimed(claimed, first, last) || !CardScrubber.isLuhnValid(digits)) continue;

        const start = groups[first].offset;
        spans.push([start, groups[last].offset + groups[last].text.length - start]);

        for (let index = first; index <= last; index++) claimed.add(index);
      }
    }

    if (spans.length === 0) return spans;

    // A run that holds a card number holds the rest of the card: a gateway request dumped as
    // space-separated fields puts the security code and the expiry right beside it, and neither is
    // Luhn-checkable or named here, so shape alone would never find them. Bounded to short groups
    // inside a run already proven to contain a PAN.
    for (let index = 0; index < count; index++) {
      if (claimed.has(index) || held.has(index) || groups[index].text.length > 4) continue;
      spans.push([groups[index].offset, groups[index].text.length]);
    }

    return spans;
  }

  /**
   * The half-open `[start, end)` ranges of every uuid in `value`, or null when the scan could not
   * be completed. Null rather than an empty list on failure: an empty list would read as "no
   * uuids here" and let masking proceed on a string nothing has checked.
   */
  private static uuidRanges(value: string): Array<[number, number]> | null {
    try {
      return [...value.matchAll(CardScrubber.UUID)].map((m) => {
        const start = m.index ?? 0;
        return [start, start + m[0].length] as [number, number];
      });
    } catch {
      return null;
    }
  }

  private static anyClaimed(claimed: Set<number>, first: number, last: number): boolean {
    for (let index = first; index <= last; index++) {
      if (claimed.has(index)) return true;
    }
    return false;
  }

  /** Whether a run of digits satisfies the Luhn check digit. */
  private static isLuhnValid(digits: string): boolean {
    let sum = 0;
    let double = false;

    for (let i = digits.length - 1; i >= 0; i--) {
      let digit = Number(digits[i]);
      if (double) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      double = !double;
    }

    return sum % 10 === 0;
  }
}
