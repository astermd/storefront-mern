type RawRecord = Record<string, unknown>;

interface Schedule {
  start_day: number;
  recurrence: string;
  interval_days: number;
  occurrence_count: number;
}

/** One plan the catalog sells a variant on: the product and variant it sells, and its first payment. */
export interface PlanRow {
  plan_id: string;
  name: string;
  display_name: string;
  product_id: string;
  variant_id: string;
  first_payment_cents: number;
  allow_coupons: boolean;
}

const OBJECT_ID = /^[a-f\d]{24}$/i;

/** A step that never ends is only looked at this many cycles ahead (the engine's safety stop). */
const MAX_CYCLES_AHEAD = 60;

/**
 * Ported from storefront-lamp/core/Catalog/SubscriptionPlans.php. Pure transform: the
 * `subscriptions` of an EMR Channel Details response -> the plan rows `CatalogBuilder.build()`
 * sells variants on.
 *
 * The EMR lists the plans assigned to the channel that can be sold (active, the org's, on the
 * channel's payment provider), each with the whole plan. A storefront that creates its own payment
 * names a plan line by the plan's id and charges the plan's first payment for it — the price the
 * EMR quotes a discount code against — so each row here names the product and variant the plan
 * sells and that first payment, worked out from the plan's steps exactly as the EMR's sales service
 * does (`src/lib/subscription/plan-product.ts` and `plan-first-payment.ts` there; the subscription
 * engine's rule). Keep the two in step: a figure that differs from the EMR's is a discount the EMR
 * prices on a different total.
 *
 * A plan that names no product, or whose first payment cannot be priced, is left out rather than
 * repaired: a plan the storefront cannot price is one it must not sell.
 */
export class SubscriptionPlans {
  /** @param channelData the `data` subtree of a Channel Details response */
  static fromChannelDetails(channelData: RawRecord): PlanRow[] {
    const plans: PlanRow[] = [];

    for (const row of SubscriptionPlans.rows(channelData.subscriptions)) {
      const plan = SubscriptionPlans.isRecord(row.plan) ? row.plan : null;
      if (plan === null) continue;

      const id = SubscriptionPlans.idText(plan._id ?? row.plan_id ?? null);
      const ref = SubscriptionPlans.productRef(plan);
      const payment = SubscriptionPlans.firstPayment(plan);
      if (id === null || ref === null || payment === null) continue;

      const name = typeof plan.name === 'string' ? plan.name : '';
      const displayName = typeof plan.display_name === 'string' && plan.display_name !== '' ? plan.display_name : name;

      plans.push({
        plan_id: id,
        name,
        display_name: displayName,
        product_id: ref.product_id,
        variant_id: ref.variant_id,
        first_payment_cents: payment.amount_cents,
        allow_coupons: payment.allow_coupons,
      });
    }

    return plans;
  }

  /**
   * The product and variant a plan sells: its product, and the variant it ships of that product —
   * the first item for the product with a variant in the first cycle of a shipment step, in step
   * order. A plan that ships no variant of it sells the product by its own id, as a product without
   * variants is named. Null when the plan names no product.
   */
  static productRef(plan: RawRecord): { product_id: string; variant_id: string } | null {
    const productId = SubscriptionPlans.idText(plan.product_id);
    if (productId === null) return null;

    for (const step of SubscriptionPlans.rows(plan.steps)) {
      if (step.type !== 'shipment') continue;
      const firstCycle = SubscriptionPlans.rows(step.items_by_cycle)[0];
      for (const item of SubscriptionPlans.rows(firstCycle?.items)) {
        const variantId = SubscriptionPlans.idText(item.variant_id);
        if (variantId !== null && SubscriptionPlans.idText(item.product_id) === productId) {
          return { product_id: productId, variant_id: variantId };
        }
      }
    }

    return { product_id: productId, variant_id: productId };
  }

  /**
   * What the plan charges at checkout: cycle 1 of its first charge step, in step order, due on day
   * 0 that does not capture a pre-auth. A `fixed` charge pays its own amount; any other pays for
   * each cycle of the shipments or lab tests in `pays_for_step_ids` due from day 0 until its next
   * charge. A plan with no charge due on day 0 charges nothing.
   *
   * Whether a discount code may apply is the step's `allow_coupons` — for a pre-auth, the flag of
   * the step that captures it, since the engine applies coupons when money is taken.
   *
   * Null when the plan cannot be priced (a malformed charge or price).
   */
  static firstPayment(plan: RawRecord): { amount_cents: number; allow_coupons: boolean } | null {
    const steps = SubscriptionPlans.rows(plan.steps);

    const step =
      steps.find((candidate) => {
        const schedule = SubscriptionPlans.isRecord(candidate.schedule) ? candidate.schedule : {};
        return candidate.type === 'charge' && SubscriptionPlans.num(schedule.start_day) === 0 && !candidate.captures_step_id;
      }) ?? null;
    if (step === null) return { amount_cents: 0, allow_coupons: true };

    let capture: RawRecord | null = null;
    if (step.payment_mode === 'pre_auth') {
      capture = steps.find((candidate) => candidate.type === 'charge' && candidate.captures_step_id === step.step_id) ?? null;
    }
    const allowCoupons = (capture ?? step).allow_coupons !== false;

    if ((step.amount_source ?? 'fixed') === 'fixed') {
      const amount = SubscriptionPlans.num(step.amount_cents);
      return SubscriptionPlans.wholeCents(amount) ? { amount_cents: amount, allow_coupons: allowCoupons } : null;
    }

    const charge = SubscriptionPlans.scheduleOf(step);
    if (charge === null) return null;

    let amount = 0;
    const paysFor = Array.isArray(step.pays_for_step_ids) ? step.pays_for_step_ids : [];
    for (const id of paysFor) {
      const paid = steps.find((candidate) => candidate.step_id === id) ?? null;
      const paidSchedule = paid !== null ? SubscriptionPlans.scheduleOf(paid) : null;
      if (paid === null || paidSchedule === null) continue;
      for (const cycle of SubscriptionPlans.paidCycles(charge, paidSchedule)) {
        const cost = SubscriptionPlans.cycleAmount(paid, cycle);
        if (cost === null) return null;
        amount += cost;
      }
    }

    return SubscriptionPlans.wholeCents(amount) ? { amount_cents: amount, allow_coupons: allowCoupons } : null;
  }

  private static scheduleOf(step: RawRecord): Schedule | null {
    const schedule = SubscriptionPlans.isRecord(step.schedule) ? step.schedule : null;
    const startDay = SubscriptionPlans.num(schedule?.start_day);
    if (schedule === null || startDay === null) return null;

    return {
      start_day: startDay,
      recurrence: typeof schedule.recurrence === 'string' ? schedule.recurrence : 'once',
      interval_days: SubscriptionPlans.num(schedule.interval_days) ?? 0,
      occurrence_count: SubscriptionPlans.num(schedule.occurrence_count) ?? 1,
    };
  }

  /** Occurrence k is due on day start_day + k * interval_days. */
  private static dueDay(s: Schedule, k: number): number | null {
    switch (s.recurrence) {
      case 'once':
        return k === 0 ? s.start_day : null;
      case 'fixed_count':
        return k < s.occurrence_count ? s.start_day + k * s.interval_days : null;
      case 'ongoing':
        return s.start_day + k * s.interval_days;
      default:
        return null;
    }
  }

  /** The latest occurrence due on or before the day, or null when none is due yet. */
  private static latestDueBy(s: Schedule, day: number): number | null {
    if (day < s.start_day) return null;
    if (s.recurrence === 'once') return 0;
    if (s.interval_days <= 0) return null;
    const k = Math.floor((day - s.start_day) / s.interval_days);

    switch (s.recurrence) {
      case 'fixed_count':
        return Math.trunc(Math.min(s.occurrence_count - 1, k));
      case 'ongoing':
        return k;
      default:
        return null;
    }
  }

  private static finalIndex(s: Schedule): number | null {
    switch (s.recurrence) {
      case 'once':
        return 0;
      case 'fixed_count':
        return Math.trunc(s.occurrence_count) - 1;
      default:
        return null;
    }
  }

  /** The cycles of `paid` that the charge's first occurrence pays for: due from its day until its next. */
  private static paidCycles(charge: Schedule, paid: Schedule): number[] {
    const from = SubscriptionPlans.dueDay(charge, 0);
    if (from === null) return [];
    const next = SubscriptionPlans.dueDay(charge, 1);
    const before = SubscriptionPlans.latestDueBy(paid, from - 1);
    const first = before === null ? 0 : before + 1;
    const through = next === null ? (SubscriptionPlans.finalIndex(paid) ?? first + MAX_CYCLES_AHEAD - 1) : SubscriptionPlans.latestDueBy(paid, next - 1);
    if (through === null || through < first) return [];

    return Array.from({ length: through - first + 1 }, (_, i) => first + i);
  }

  /** What a shipment or lab test step costs in one of its cycles. Null when a price is unreadable. */
  private static cycleAmount(step: RawRecord, cycle: number): number | null {
    if (step.type === 'lab_test') return SubscriptionPlans.num(step.price_cents);
    if (step.type !== 'shipment') return 0;

    const cycles = SubscriptionPlans.rows(step.items_by_cycle);
    if (cycles.length === 0) return 0;

    let sum = 0;
    for (const item of SubscriptionPlans.rows(cycles[Math.min(cycle, cycles.length - 1)].items)) {
      const price = SubscriptionPlans.num(item.price_cents);
      const quantity = SubscriptionPlans.num(item.quantity);
      if (price === null || quantity === null) return null;
      sum += price * quantity;
    }

    return sum;
  }

  /** A JSON number; null for anything else. */
  private static num(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private static wholeCents(amount: number | null): amount is number {
    return amount !== null && amount >= 0 && Math.floor(amount) === amount;
  }

  /** An ObjectId as lower-case hex; null for anything else. */
  private static idText(value: unknown): string | null {
    let id = value;
    if (SubscriptionPlans.isRecord(id) && typeof id.$oid === 'string') id = id.$oid;

    return typeof id === 'string' && OBJECT_ID.test(id) ? id.toLowerCase() : null;
  }

  private static isRecord(value: unknown): value is RawRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  /** The object entries of a list, skipping anything that is not an object. */
  private static rows(value: unknown): RawRecord[] {
    return Array.isArray(value) ? value.filter((v): v is RawRecord => SubscriptionPlans.isRecord(v)) : [];
  }
}
