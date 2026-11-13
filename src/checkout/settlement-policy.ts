import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { PRODUCT_CATALOG } from '../core/tokens';
import { CartLine } from '../domain/cart-line';
import { ProductCatalog } from '../domain/product-catalog';
import { VariantPlans } from '../domain/variant-plans';
import { OperatorLog } from '../support/operator-log';
import { ConfigService } from '../support/config';
import { SettlementMode, SettlementModeValue } from '../payment/settlement-mode';

/**
 * Whether an order takes the money
 * or reserves it — decided once, here.
 *
 * Three layers: the deployment default (`config/payment.ts`) answers "how does this storefront
 * settle"; the per-product `settlement` override key answers "does this particular thing get
 * charged before somebody has approved it" — a clinical or fulfilment fact that varies inside one
 * deployment; and a line sold on a subscription plan settles as the plan's first charge says
 * (`forLines()`): the plan is the EMR's own statement of whether its first payment is held or
 * taken, written by `theme:sync` onto the plan (`PLAN_KEY`), so neither of the other two speaks
 * for it.
 *
 * **A cart resolves to one mode, and authorize wins** (`[13.19]`: the whole cart is one order). An
 * unrecognised spelling falls back to the deployment default and is logged, rather than guessed at
 * in either direction.
 */
@Injectable()
export class SettlementPolicy {
  private readonly default: SettlementModeValue;

  constructor(
    @Inject(PRODUCT_CATALOG) private readonly catalog: ProductCatalog,
    config: ConfigService,
    private readonly log: OperatorLog,
  ) {
    this.default = SettlementPolicy.modeFromConfig(config.payment.settlement);
  }

  /** The field `theme:sync` writes on each catalog plan from the plan's first charge. */
  static readonly PLAN_KEY = 'settlement';

  static modeFromConfig(configured: unknown): SettlementModeValue {
    return SettlementMode.parse(configured) ?? SettlementMode.Capture;
  }

  /** The mode for an order covering these product slugs. Total over the empty case — an upsell envelope carries exactly one line. */
  forSlugs(...slugs: string[]): SettlementModeValue {
    return SettlementMode.strictest(this.default, ...slugs.map((slug) => this.forSlug(slug)));
  }

  /**
   * The mode for an order made of these cart lines.
   *
   * A line sold on a subscription plan asks for what its plan's first charge says, and nothing
   * else: not the deployment default, not its product's own key. Nor does the default reach the
   * attachments it brought into the cart — a free supply asks for no settlement of its own, and
   * letting the default answer for it would overrule the plan by the back door. An attachment whose
   * product authors the key still asks for it.
   *
   * Every other line asks for what it would from `forSlugs()`, default folded in, so a cart with no
   * plan line settles exactly as it always has. The cart is still one order, and authorize still
   * wins it (`[13.19]`). A plan synced before plans said how they settle has no answer to give, and
   * its line settles as it did then.
   */
  forLines(...lines: CartLine[]): SettlementModeValue {
    const bySlug = new Map(lines.map((line) => [line.slug, line]));
    const modes: SettlementModeValue[] = [];
    const planned = new Set<string>();

    for (const line of lines) {
      if (line.isChild()) continue;

      const mode = this.planMode(line);
      if (mode !== null) {
        modes.push(mode);
        planned.add(line.slug);
        continue;
      }

      modes.push(this.default, this.forSlug(line.slug));
    }

    for (const line of lines) {
      if (!line.isChild()) continue;
      if (planned.has(SettlementPolicy.rootSlug(line, bySlug)) && !this.authors(line.slug)) continue;

      modes.push(this.forSlug(line.slug));
    }

    return modes.length === 0 ? this.default : SettlementMode.strictest(...modes);
  }

  /** The mode one product asks for, or the deployment default when it asks for nothing (or names no product at all — free attachments/bundle children reach here too). */
  forSlug(slug: string): SettlementModeValue {
    const product = this.catalog.product(slug);
    if (product === null || product.settlement === undefined) {
      return this.default;
    }

    const parsed = SettlementMode.parse(product.settlement);
    if (parsed === null) {
      this.log.error('checkout.settlement_unrecognised', { slug, default: this.default });
      return this.default;
    }

    return parsed;
  }

  /**
   * What the line's plan asks for: the plan the order will name, resolved by the same rule the
   * order resolves it by, so the line held is the line charged. Null when the line is sold one-off,
   * or on a plan synced before plans said how they settle — and, logged like a product's typo, when
   * an override wrote something that is not a mode.
   */
  private planMode(line: CartLine): SettlementModeValue | null {
    const variant = VariantPlans.variant(this.catalog.product(line.slug), line.variantId);
    const plan = VariantPlans.chosen(variant, line.planId);
    if (plan === null || plan[SettlementPolicy.PLAN_KEY] === undefined) return null;

    const parsed = SettlementMode.parse(plan[SettlementPolicy.PLAN_KEY]);
    if (parsed === null) {
      this.log.error('checkout.settlement_unrecognised', { slug: line.slug, plan_id: plan.id, default: this.default });
    }

    return parsed;
  }

  private authors(slug: string): boolean {
    const product = this.catalog.product(slug);
    return product !== null && product.settlement !== undefined;
  }

  /** The top-level line an attachment hangs from, however deep: an add-on's own lab test is still part of the plan line that brought the add-on. */
  private static rootSlug(line: CartLine, bySlug: Map<string, CartLine>): string {
    const seen = new Set<string>();
    let current = line;
    while (current.parentSlug !== null && bySlug.has(current.parentSlug) && !seen.has(current.slug)) {
      seen.add(current.slug);
      current = bySlug.get(current.parentSlug)!;
    }

    return current.slug;
  }
}
