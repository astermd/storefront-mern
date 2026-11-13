import { CatalogProduct, ProductVariant, VariantPlan } from './product-catalog';

/**
 * Which subscription plan a cart line is
 * sold on, read off the catalog in the one place every reader asks it.
 *
 * `theme:sync` puts a variant the EMR sells on plans onto all of them: `plans` lists every one,
 * lowest id first, and `plan` is the default the variant is priced on (`CatalogBuilder`). The cart
 * prices a line on the plan the buyer chose, the order names it, the settlement follows its first
 * charge and the checkout offers the others. If those four each resolved a line's plan their own
 * way, the plan charged could differ from the plan shown, the plan held from the plan named, and
 * nothing would say so.
 *
 * `plan` is what says a variant is sold on a plan at all. An override that sells the variant
 * one-off sets it to null and leaves the generated `plans` beside it, so `plans` is never read
 * without `plan`; and a catalog synced before `plans` existed carries `plan` alone, which is one
 * plan to choose from.
 */
export class VariantPlans {
  /** The variant an order line is on: the one chosen, or the first when nothing was chosen or the product no longer has the one that was. */
  static variant(product: CatalogProduct | null, variantId: string | null): ProductVariant | null {
    const variants = (product?.variants ?? []).filter((variant) => variant !== null && typeof variant === 'object');
    if (variants.length === 0) return null;

    if (variantId !== null && variantId !== '') {
      const chosen = variants.find((variant) => String(variant.id) === variantId);
      if (chosen !== undefined) return chosen;
    }

    return variants[0];
  }

  /**
   * Every plan the variant is sold on, the default first; empty when it is sold one-off. The
   * default is whatever `plan` says rather than the first of `plans`, so an override that names
   * another plan as the default is obeyed.
   */
  static of(variant: ProductVariant | null): VariantPlan[] {
    const fallback = variant?.plan;
    if (!VariantPlans.isPlan(fallback)) return [];

    const plans: VariantPlan[] = [fallback];
    for (const plan of variant?.plans ?? []) {
      if (VariantPlans.isPlan(plan) && plan.id !== fallback.id) plans.push(plan);
    }

    return plans;
  }

  /**
   * The plan the line is sold on: the one with this id when the variant is sold on it, otherwise
   * the default; null when the variant is sold one-off.
   *
   * Falling back rather than refusing is right for the readers that call this — the order, the
   * settlement, the price — because an id the variant no longer offers can only come from a re-sync
   * since the buyer chose, and the default is the plan those readers priced the variant on before
   * choosing existed. The buyer's own choice is checked strictly, with `offers()`, before it is
   * ever stored.
   */
  static chosen(variant: ProductVariant | null, planId: string | null): VariantPlan | null {
    const plans = VariantPlans.of(variant);

    return plans.find((plan) => planId !== null && plan.id === planId) ?? plans[0] ?? null;
  }

  /** Whether the variant is sold on this plan. */
  static offers(variant: ProductVariant | null, planId: string): boolean {
    return VariantPlans.of(variant).some((plan) => plan.id === planId);
  }

  private static isPlan(plan: VariantPlan | null | undefined): plan is VariantPlan {
    return plan !== null && plan !== undefined && typeof plan === 'object' && typeof plan.id === 'string' && plan.id !== '';
  }
}
