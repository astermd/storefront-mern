/**
 * The `money()` template helper: integer cents to a display string — dollar sign, comma thousands
 * separator, 2 decimals.
 *
 * Deliberately **not** `Totals.dollars()`/`Totals.decimalString()` — those are separate,
 * non-display exits (a bare float for an API boundary; a comma-free fixed string for a payment
 * provider payload) used at their own call sites. The template helper does not depend on
 * `Totals`.
 */
export function formatMoney(cents: number): string {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
