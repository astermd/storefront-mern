import { Cart } from './cart';
import { CartLine } from './cart-line';
import { CartOutcome } from './cart-outcome';
import { CatalogProduct, ProductCatalog, ProductVariant } from './product-catalog';
import { VariantPlans } from './variant-plans';

/**
 * Every rule §7 states about a cart, as
 * pure code over a `Cart` and a `ProductCatalog`. No I/O, no framework types, no persistence —
 * which is what keeps the rules identical whether the mutation arrived from the mini-cart drawer,
 * from a checkout order bump (`[27.11]`), or from a product page whose cart view was bypassed
 * entirely (`[8.0c]`: removing a view must never remove a rule).
 *
 * Two rules here are the ones that cost money when they are wrong. A `free-addon` line is priced at
 * zero whatever the catalog says its standalone price is (`[7.14a]`). A `priced-addon` is the
 * opposite case: the channel put a price on it, so it rides along with its parent as its own
 * charged line at that price. And an attachment that cannot
 * be added blocks its parent with a stated reason rather than dropping quietly (`[7.20]`) —
 * shipping an injectable with no syringe is the failure this rule exists to prevent.
 *
 * A second prescription joins the first rather than replacing it (`[8.0f]`, `[8.0h]`). What keeps
 * that safe is not here: a cart with two or more collects no questionnaire on the storefront at all
 * (`[8.0i]`, {@link FunnelRules.collectsOnStorefront}), so no single intake is ever mistaken for an
 * assessment of every treatment.
 */
export class CartRules {
  static readonly UNKNOWN_PRODUCT = 'That product is not available.';
  static readonly GEO_BLOCKED = 'This product is not available in your region.';
  static readonly UNKNOWN_VARIANT = 'Choose a treatment plan before continuing.';

  static readonly UNKNOWN_SUBSCRIPTION = 'That subscription is not available for this treatment.';
  static readonly CHILD_UNAVAILABLE = '%s cannot be added right now: a required item (%s) is unavailable.';
  static readonly CHILD_LOCKED = '%s is included with %s and cannot be changed on its own.';
  static readonly RX_QTY_FIXED = 'Prescription quantities are fixed at one per order.';
  static readonly QTY_CAPPED = 'You can order up to %d of %s.';
  static readonly TERRITORY_BLOCKED = 'These products are not available in your region: %s.';

  /** The ceiling for a product whose catalog entry declares no `max_buy_qty` (`[7.15]`). */
  static readonly DEFAULT_MAX_QUANTITY = 10;

  constructor(private readonly catalog: ProductCatalog) {}

  /**
   * `[7.1]`-`[7.7]`, `[7.13]`, `[7.14a]`, `[7.20]`, `[8.0h]`, `[12.4]`, `[12.7]`. Every gate is
   * evaluated before anything is mutated, so a rejected add leaves the cart byte-identical.
   *
   * `[7.8]` establishes that a bundled line is not the buyer's to change; this guard applies that
   * rule to `add()` when a request names the child's slug directly, checked before the existing-line
   * lookup is used for anything else, so posting a child's slug is refused before it can change any
   * line.
   */
  add(cart: Cart, slug: string, variantId: string | null = null, quantity = 1): CartOutcome {
    const product = this.catalog.product(slug);
    if (product === null) {
      return CartOutcome.rejected(CartRules.UNKNOWN_PRODUCT);
    }

    if (CartRules.blocksTerritory(product, cart.shippingTerritory)) {
      return CartOutcome.rejected(CartRules.GEO_BLOCKED);
    }

    if (variantId !== null && CartRules.variant(product, variantId) === null) {
      return CartOutcome.rejected(CartRules.UNKNOWN_VARIANT);
    }

    const unattachable = this.unattachableDescendant(slug, cart.shippingTerritory);
    if (unattachable !== null) {
      return CartOutcome.rejected(
        CartRules.format(CartRules.CHILD_UNAVAILABLE, product.name ?? product.slug, unattachable),
      );
    }

    const existingLine = cart.line(slug);
    if (existingLine !== null && existingLine.isChild()) {
      const parent = cart.line(existingLine.parentSlug ?? '');
      return CartOutcome.rejected(
        CartRules.format(CartRules.CHILD_LOCKED, existingLine.name, parent?.name ?? existingLine.parentSlug ?? ''),
      );
    }

    let line = cart.line(slug);
    if (line === null) {
      line = CartRules.newLine(product, null);
      line.quantity = 0;
      cart.put(line);
    }

    if (variantId !== null) {
      line.variantId = variantId;
    }
    line.planId = CartRules.planFor(product, line.variantId, line.planId);
    line.unitPriceCents = CartRules.priceFor(product, line.variantId, line.planId);
    line.quantity = CartRules.clampQuantity(product, line.quantity + Math.max(1, quantity));

    this.attachChildren(cart, slug);

    return CartOutcome.accepted();
  }

  /** `[7.8]`, `[7.9]`. */
  remove(cart: Cart, slug: string): CartOutcome {
    const line = cart.line(slug);
    if (line === null) {
      return CartOutcome.rejected(CartRules.UNKNOWN_PRODUCT);
    }

    if (line.isChild()) {
      const parent = cart.line(line.parentSlug ?? '');
      return CartOutcome.rejected(
        CartRules.format(CartRules.CHILD_LOCKED, line.name, parent?.name ?? line.parentSlug ?? ''),
      );
    }

    cart.forget(slug);
    this.reattachRequiredChildren(cart);

    return CartOutcome.accepted();
  }

  /**
   * `[7.16]`: the explicit quantity operation, bounded by a per-product maximum and re-running the
   * geo and bundle rules on every change — which is what closes `[7.13]`, where an increment used
   * to slip past both.
   *
   * Zero routes through `remove()` rather than deleting the line here, so a bundled child gets the
   * same refusal whether the buyer pressed the bin or stepped the quantity down to nothing.
   */
  setQuantity(cart: Cart, slug: string, quantity: number): CartOutcome {
    const line = cart.line(slug);
    if (line === null) {
      return CartOutcome.rejected(CartRules.UNKNOWN_PRODUCT);
    }

    if (line.isChild()) {
      const parent = cart.line(line.parentSlug ?? '');
      return CartOutcome.rejected(
        CartRules.format(CartRules.CHILD_LOCKED, line.name, parent?.name ?? line.parentSlug ?? ''),
      );
    }

    if (quantity <= 0) {
      return this.remove(cart, slug);
    }

    if (line.kind === 'rx') {
      return CartOutcome.rejected(CartRules.RX_QTY_FIXED);
    }

    const product = this.catalog.product(slug);
    if (product === null) {
      return CartOutcome.rejected(CartRules.UNKNOWN_PRODUCT);
    }

    if (CartRules.blocksTerritory(product, cart.shippingTerritory)) {
      return CartOutcome.rejected(CartRules.GEO_BLOCKED);
    }

    const unattachable = this.unattachableDescendant(slug, cart.shippingTerritory);
    if (unattachable !== null) {
      return CartOutcome.rejected(CartRules.format(CartRules.CHILD_UNAVAILABLE, line.name, unattachable));
    }

    const clamped = CartRules.clampQuantity(product, quantity);
    line.quantity = clamped;
    this.attachChildren(cart, slug);

    return clamped < quantity
      ? CartOutcome.accepted(CartRules.format(CartRules.QTY_CAPPED, clamped, line.name))
      : CartOutcome.accepted();
  }

  /**
   * `[12.4]`, `[12.7]`: a variant is a plan, so choosing one is the moment an Rx line stops being
   * zero-priced. An identifier that does not belong to that product is refused rather than falling
   * back to the first variant (`[12.9]`).
   */
  chooseVariant(cart: Cart, slug: string, variantId: string): CartOutcome {
    const line = cart.line(slug);
    const product = this.catalog.product(slug);
    if (line === null || product === null) {
      return CartOutcome.rejected(CartRules.UNKNOWN_PRODUCT);
    }

    if (CartRules.variant(product, variantId) === null) {
      return CartOutcome.rejected(CartRules.UNKNOWN_VARIANT);
    }

    line.variantId = variantId;
    line.planId = CartRules.planFor(product, variantId, line.planId);
    line.unitPriceCents = CartRules.priceFor(product, variantId, line.planId);

    return CartOutcome.accepted();
  }

  /**
   * `[12.4]`: which of its variant's subscription plans a line is sold on, re-pricing it at that
   * plan's first payment. A plan the line's variant is not sold on is refused rather than replaced
   * by the default, for the reason a foreign variant is (`[12.9]`): the order would name a plan the
   * buyer was never shown.
   */
  chooseSubscription(cart: Cart, slug: string, planId: string): CartOutcome {
    const line = cart.line(slug);
    const product = this.catalog.product(slug);
    if (line === null || product === null) {
      return CartOutcome.rejected(CartRules.UNKNOWN_PRODUCT);
    }

    if (!VariantPlans.offers(CartRules.pricedVariant(product, line.variantId), planId)) {
      return CartOutcome.rejected(CartRules.UNKNOWN_SUBSCRIPTION);
    }

    line.planId = planId;
    line.unitPriceCents = CartRules.priceFor(product, line.variantId, planId);

    return CartOutcome.accepted();
  }

  /**
   * `[13.6]`, `[13.7]`: the gate is re-run against the freshly submitted territory across every
   * line, not just against whatever was known when each was added. A block leaves the cart
   * completely intact and names the products.
   */
  applyTerritory(cart: Cart, territory: string): CartOutcome {
    const blocked: string[] = [];
    for (const line of cart.lines()) {
      const product = this.catalog.product(line.slug);
      if (product === null) continue;

      const blockedHere =
        CartRules.blocksTerritory(product, territory) || this.unattachableDescendant(line.slug, territory) !== null;

      if (blockedHere) {
        blocked.push(line.name);
      }
    }

    if (blocked.length > 0) {
      return CartOutcome.rejected(CartRules.format(CartRules.TERRITORY_BLOCKED, blocked.join(', ')));
    }

    cart.shippingTerritory = territory;
    return CartOutcome.accepted();
  }

  /**
   * Re-establishes the invariant that a child line exists exactly while some surviving line still
   * requires it — two products may legitimately require the same lab test or supply (`[7.7]`), so
   * removing the parent that happened to attach it first must not take a line the surviving parent
   * still needs (`[7.20]`).
   */
  private reattachRequiredChildren(cart: Cart): void {
    for (const line of cart.lines()) {
      if (!line.isChild()) {
        this.attachChildren(cart, line.slug);
      }
    }
  }

  /**
   * Adds every mandatory bundle and free attachment declared on `slug`, and recurses into theirs
   * (`[7.5]`, `[7.6]`). An item already in the cart is left alone, so two parents needing the same
   * lab test produce one line (`[7.7]`).
   */
  private attachChildren(cart: Cart, parentSlug: string, visited: Set<string> = new Set()): void {
    if (visited.has(parentSlug)) return;
    visited.add(parentSlug);

    const parent = this.catalog.product(parentSlug);
    if (parent === null) return;

    for (const childSlug of CartRules.childSlugs(parent)) {
      const child = this.catalog.product(childSlug);
      if (child === null) continue;

      if (!cart.has(childSlug)) {
        const line = CartRules.newLine(child, parentSlug);
        line.unitPriceCents = CartRules.priceFor(child, null);
        cart.put(line);
      }

      this.attachChildren(cart, childSlug, visited);
    }
  }

  /** The first bundle or attachment beneath `slug` that cannot be added (`[7.20]`). */
  private unattachableDescendant(
    slug: string,
    territory: string | null,
    visited: Set<string> = new Set(),
  ): string | null {
    if (visited.has(slug)) return null;
    visited.add(slug);

    const product = this.catalog.product(slug);
    if (product === null) return null;

    for (const childSlug of CartRules.childSlugs(product)) {
      const child = this.catalog.product(childSlug);
      if (child === null || CartRules.blocksTerritory(child, territory)) {
        return childSlug;
      }

      const deeper = this.unattachableDescendant(childSlug, territory, visited);
      if (deeper !== null) return deeper;
    }

    return null;
  }

  private static childSlugs(product: CatalogProduct): string[] {
    return [...(product.bundles ?? []), ...(product.attachments ?? [])].filter((s) => s !== '');
  }

  private static newLine(product: CatalogProduct, parentSlug: string | null): CartLine {
    return new CartLine(
      product.slug,
      product.name ?? product.slug,
      product.kind ?? 'otc',
      product.emr_product_id ?? null,
      parentSlug,
    );
  }

  /**
   * `[7.4]` with `[7.14a]` on top: a `free-addon` is always zero, an `rx` with no plan chosen yet
   * is zero because its price is not knowable until the variant is (`[12.4]`), and everything else
   * takes the chosen variant's price or the first variant's — or, for a variant sold on a
   * subscription plan the buyer chose over its default, that plan's first payment.
   */
  private static priceFor(product: CatalogProduct, variantId: string | null, planId: string | null = null): number {
    if (product.kind === 'free-addon') return 0;

    if (variantId !== null) {
      const variant = CartRules.variant(product, variantId);
      if (variant !== null) return CartRules.planPrice(variant, planId) ?? variant.price_cents ?? 0;
    }

    if (product.kind === 'rx') return 0;

    const variants = CartRules.variants(product);
    const planned = variants[0] !== undefined ? CartRules.planPrice(variants[0], planId) : null;

    return planned ?? variants[0]?.price_cents ?? product.price_cents ?? 0;
  }

  /**
   * The first payment of the plan the buyer chose for this variant, or null when the variant's own
   * price stands: it is sold one-off, or on its default plan, whose first payment `theme:sync`
   * already wrote into `price_cents` — where a deployment's override of that price must keep
   * winning, as it did before a plan could be chosen.
   */
  private static planPrice(variant: ProductVariant, planId: string | null): number | null {
    const plan = VariantPlans.chosen(variant, planId);
    const fallback = VariantPlans.of(variant)[0] ?? null;

    if (plan === null || plan.id === fallback?.id || !Number.isInteger(plan.first_payment_cents)) return null;

    return plan.first_payment_cents as number;
  }

  /**
   * The plan a line is on once its variant is known: the one it is already on while that variant
   * is still sold on it, otherwise the variant's default; null for a variant sold one-off, and for
   * an Rx line whose variant is not chosen yet, which has no plan until it has a variant (`[12.9]`).
   */
  private static planFor(product: CatalogProduct, variantId: string | null, planId: string | null): string | null {
    return VariantPlans.chosen(CartRules.pricedVariant(product, variantId), planId)?.id ?? null;
  }

  /** The variant a line is priced on, by `priceFor()`'s rule: the chosen one, or the first for anything but an Rx line, whose variant has to be chosen. */
  private static pricedVariant(product: CatalogProduct, variantId: string | null): ProductVariant | null {
    const variant = variantId !== null ? CartRules.variant(product, variantId) : null;
    if (variant !== null || product.kind === 'rx') return variant;

    return CartRules.variants(product)[0] ?? null;
  }

  private static variant(product: CatalogProduct, variantId: string): ProductVariant | null {
    return CartRules.variants(product).find((v) => v.id === variantId) ?? null;
  }

  private static variants(product: CatalogProduct): NonNullable<CatalogProduct['variants']> {
    return product.variants ?? [];
  }

  /**
   * A prescription line's quantity is always one; everything else is capped by the catalog's own
   * `max_buy_qty` when it declares one, and by `DEFAULT_MAX_QUANTITY` when it does not.
   */
  private static clampQuantity(product: CatalogProduct, quantity: number): number {
    if (product.kind === 'rx') return 1;

    const max = product.max_buy_qty && product.max_buy_qty > 0 ? Math.max(1, product.max_buy_qty) : CartRules.DEFAULT_MAX_QUANTITY;

    return Math.max(1, Math.min(quantity, max));
  }

  private static blocksTerritory(product: CatalogProduct, territory: string | null): boolean {
    if (territory === null || territory === '') return false;

    return (product.geo_blocks ?? []).some((blocked) => blocked.toLowerCase() === territory.toLowerCase());
  }

  private static format(template: string, ...args: Array<string | number>): string {
    let i = 0;
    return template.replace(/%s|%d/g, () => String(args[i++]));
  }
}
