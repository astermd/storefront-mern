import { createHash } from 'node:crypto';
import { Cart } from '../domain/cart';
import { CartLine } from '../domain/cart-line';

/**
 * Ported from storefront-lamp/core/Checkout/IdempotencyKey.php. One checkout attempt's key
 * (`[13.37]`).
 *
 * Derived from what is being bought and who is buying it, rather than issued as a random token on
 * page render, because the two failure modes it has to separate look identical to a token: a
 * double-click posts the same form twice and must be recognised as one attempt, while a retry
 * after correcting a typo'd address is a *new* attempt and must reach the provider. It doubles as
 * `[13.38]`'s stale-form guard: a cart mutated in another tab between render and submit changes
 * the key.
 *
 * Nothing about the card is ever among the inputs (`[15.8]`): a digest that lands in a durable
 * column is one more place a card has been.
 */
export class IdempotencyKey {
  static forSubmit(sessionUuid: string | null, sessionKey: string, cart: Cart, buyer: Record<string, string>): string {
    const lines = cart.lines().map((line) => IdempotencyKey.lineMaterial(line));
    lines.sort();

    const sortedBuyer = Object.fromEntries(Object.entries(buyer).sort(([a], [b]) => a.localeCompare(b)));

    const material = [sessionUuid ?? '', sessionKey, lines.join(';'), JSON.stringify(sortedBuyer)].join('|');

    return createHash('sha1').update(material).digest('hex');
  }

  /**
   * The key for one accepted upsell — keyed on the offer rather than the cart, since `[13.32]`
   * clears the cart when the first order is placed. Deliberately excludes both price (which may
   * move between two clicks on the same offer) and the credential (`[15.8]`).
   */
  static forUpsell(sessionUuid: string | null, sessionKey: string, upsellKey: string, slug: string, variantId: string | null): string {
    const material = ['upsell', sessionUuid ?? '', sessionKey, upsellKey, slug, variantId ?? ''].join('|');
    return createHash('sha1').update(material).digest('hex');
  }

  private static lineMaterial(line: CartLine): string {
    return [line.slug, line.variantId ?? '', String(line.quantity), String(line.unitPriceCents)].join(':');
  }
}
