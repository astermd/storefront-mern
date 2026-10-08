import { CartData } from '../journey/journey-state';
import { CartLine } from './cart-line';

/**
 * Ported from storefront-lamp/core/Domain/Cart.php. The visitor's cart: an ordered set of lines,
 * at most one per product, plus the shipping territory the geo gate is evaluated against once
 * checkout knows it (`[13.3]`).
 *
 * The rules live in `CartRules` rather than here on purpose. This class owns only what cannot be
 * got wrong — uniqueness by slug, and the parent link's one structural consequence, that removing
 * a parent takes its children with it in a single operation (`[7.9]`).
 */
export class Cart {
  private cartLines: CartLine[] = [];
  shippingTerritory: string | null = null;

  lines(): CartLine[] {
    return this.cartLines;
  }

  line(slug: string): CartLine | null {
    return this.cartLines.find((l) => l.slug === slug) ?? null;
  }

  has(slug: string): boolean {
    return this.line(slug) !== null;
  }

  isEmpty(): boolean {
    return this.cartLines.length === 0;
  }

  /** Appends the line, or replaces the existing one for that slug in place. */
  put(line: CartLine): void {
    const index = this.cartLines.findIndex((l) => l.slug === line.slug);
    if (index === -1) {
      this.cartLines.push(line);
    } else {
      this.cartLines[index] = line;
    }
  }

  /**
   * Removes the line and everything that declares it as a parent, however deep — a bundle may
   * itself pull in bundles (`[7.5]`), so removal has to follow the same tree the add built.
   */
  forget(slug: string): void {
    const doomed = new Set<string>([slug]);

    let added = true;
    while (added) {
      added = false;
      for (const line of this.cartLines) {
        if (line.parentSlug !== null && doomed.has(line.parentSlug) && !doomed.has(line.slug)) {
          doomed.add(line.slug);
          added = true;
        }
      }
    }

    this.cartLines = this.cartLines.filter((line) => !doomed.has(line.slug));
  }

  childrenOf(slug: string): CartLine[] {
    return this.cartLines.filter((line) => line.parentSlug === slug);
  }

  hasRx(): boolean {
    return this.rxLines().length > 0;
  }

  /**
   * Every prescription line, in the order it was added. An order may carry several (`[8.0f]`); how
   * many there are is what decides whether the storefront collects a questionnaire at all (`[8.0i]`).
   */
  rxLines(): CartLine[] {
    return this.cartLines.filter((line) => line.kind === 'rx');
  }

  /** What the navbar badge shows: top-level quantities only. */
  itemCount(): number {
    return this.cartLines.filter((line) => !line.isChild()).reduce((sum, line) => sum + line.quantity, 0);
  }

  /** Every line, children included — a mandatory bundle is a real charge (`[7.14b]`). */
  subtotalCents(): number {
    return this.cartLines.reduce((sum, line) => sum + line.lineTotalCents(), 0);
  }

  toArray(): CartData {
    return {
      lines: this.cartLines.map((line) => line.toArray()),
      territory: this.shippingTerritory,
    };
  }

  static fromArray(data: Partial<CartData>): Cart {
    const cart = new Cart();
    for (const line of data.lines ?? []) {
      cart.put(CartLine.fromArray(line));
    }
    cart.shippingTerritory = data.territory ? data.territory : null;
    return cart;
  }
}
