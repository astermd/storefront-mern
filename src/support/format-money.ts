/**
 * Ported from storefront-lamp's Twig `money` filter (`core/Http/TwigExtensions.php`):
 * `'$' . number_format($cents / 100, 2)` — dollar sign, comma thousands separator, 2 decimals.
 *
 * Deliberately **not** `Checkout\Totals::dollars()`/`decimalString()` — those are separate,
 * non-display exits (a bare float for an API boundary; a comma-free fixed string for a payment
 * provider payload) that Phase 7 ports on its own schedule for their own call sites. The template
 * filter never depended on `Totals` in the PHP original, so it doesn't need to wait for it either.
 */
export function formatMoney(cents: number): string {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
