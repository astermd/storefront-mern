import { CatalogProduct, ProductVariant } from '../domain/product-catalog';
import { PlanRow } from './subscription-plans';

const PLACEHOLDER_IMAGE = '/assets/img/product-placeholder.svg';
const PRICE_UNIT = '/ month';

export interface BuiltCatalog {
  channel: { id: unknown; name: unknown; currency: string };
  products: Record<string, CatalogProduct>;
}

type RawRecord = Record<string, unknown>;

type PlanAttachment = { id: string; name: string; first_payment_cents: number; allow_coupons: boolean };

/**
 * Ported from storefront-lamp/core/Catalog/CatalogBuilder.php. Pure transform: the `data` subtree
 * of an EMR Channel Details response (the raw, unflattened payload — `response.data()`, never the
 * SDK's `ChannelDetail.from()` presenter, which reshapes the tree this class's field access
 * patterns depend on) → the generated catalog every later step of the pipeline (rendering,
 * provider resolution, validation) consumes. No I/O, no SDK types — `build()` is a deterministic
 * function of its input, exhaustively unit-testable without any test doubles.
 *
 * Bracketed numbers ([2.10], [2.12]-[2.15], [2.18], ...) are the PHP original's behaviour-rule ids
 * (`storefront-lamp/docs/SPEC-REFERENCE.md`, "2. Configuration and the catalog model"). Every rule
 * below implements one of them.
 */
export class CatalogBuilder {
  /**
   * @param plans the channel's sellable subscription plans, each naming the product and variant it
   *   sells (`SubscriptionPlans.fromChannelDetails()`); empty for none
   */
  static build(channelData: RawRecord, currency = 'USD', plans: PlanRow[] = []): BuiltCatalog {
    const planIndex = CatalogBuilder.planIndex(plans);
    const products: Record<string, CatalogProduct> = {};
    const rawProducts = Array.isArray(channelData.products) ? channelData.products : [];
    const paymentProcessor = channelData.payment_processor && typeof channelData.payment_processor === 'object' ? (channelData.payment_processor as RawRecord) : {};
    const activeProcessorType = typeof paymentProcessor.provider_category === 'string' ? paymentProcessor.provider_category : null;

    for (const rawEntry of rawProducts) {
      const entry = (rawEntry && typeof rawEntry === 'object' ? rawEntry : {}) as RawRecord;
      const product = entry.product && typeof entry.product === 'object' ? (entry.product as RawRecord) : {};

      // Rule 11 [visibility gate]: only channel products that are both active (`status === 1`) and
      // public are surfaced. Nested lab/add-on children are NOT re-checked here — as long as their
      // parent survives, they are kept regardless of their own status/visibility fields.
      if (product.status !== 1 || product.visibility !== 'Public') {
        continue;
      }

      const mappings = Array.isArray(entry.product_mappings) ? (entry.product_mappings as RawRecord[]) : [];

      // Rule 6 [2.12, 2.14]: every labtest entry becomes a standalone `lab` product; the same
      // nested `_id` referenced by more than one parent is emitted once, and every parent that
      // references it records its slug in `bundles`.
      const bundles: string[] = [];
      for (const lab of Array.isArray(product.labtest) ? product.labtest : []) {
        if (lab && typeof lab === 'object') bundles.push(CatalogBuilder.addNestedProduct(products, lab as RawRecord, 'lab'));
      }

      // Rule 7 [2.13]: every add_ons entry becomes a standalone product, recorded in
      // the parent's `attachments`: a `free-addon` unless the channel prices it, then a `priced-addon`
      // (see addNestedProduct). Note `add_ons` is a sibling of `product` on the wrapper entry,
      // not nested inside `product` the way `labtest` is.
      const attachments: string[] = [];
      for (const addOn of Array.isArray(entry.add_ons) ? entry.add_ons : []) {
        if (addOn && typeof addOn === 'object') attachments.push(CatalogBuilder.addNestedProduct(products, addOn as RawRecord, 'free-addon'));
      }

      const slug = CatalogBuilder.makeSlug(String(product._id), String(product.name));

      // Unlike addNestedProduct's intentional dedupe (same shared lab/add-on referenced by
      // multiple parents -> one product), two DIFFERENT top-level EMR products colliding on the
      // same slug is a data-integrity problem, not a legitimate dedupe: silently overwriting one
      // with the other is catalog data loss.
      if (products[slug]) {
        throw new Error(`CatalogBuilder: slug collision "${slug}" between EMR product ids "${String(products[slug].emr_product_id)}" and "${String(product._id)}"`);
      }

      const variants = CatalogBuilder.attachPlans(
        CatalogBuilder.buildVariants(Array.isArray(product.variants) ? product.variants : [], product, mappings, activeProcessorType),
        String(product._id),
        planIndex,
      );

      products[slug] = {
        slug,
        name: String(product.name),
        subtitle: null,
        // Rule 2: EMR `type` of `prescription` -> `rx`; every other type (`standard`, etc.) -> `otc`.
        kind: CatalogBuilder.kindOf(product.type),
        categories: CatalogBuilder.namesOf(Array.isArray(product.categories) ? product.categories : []),
        condition_treated: CatalogBuilder.namesOf(Array.isArray(product.condition_treated) ? product.condition_treated : []),
        description: CatalogBuilder.stringOr(product.description_long, CatalogBuilder.stringOr(product.description_short, '')),
        // Product-level price mirrors the first variant's price.
        price_cents: variants[0]?.price_cents ?? 0,
        price_unit: PRICE_UNIT,
        image: PLACEHOLDER_IMAGE,
        gallery: [PLACEHOLDER_IMAGE],
        badges: [],
        emr_product_id: product._id !== undefined && product._id !== null ? String(product._id) : null,
        remote_image: typeof product.image === 'string' ? product.image : null,
        // Rule 8: first teleform's id, or absent when none configured.
        teleform_id: CatalogBuilder.firstTeleformId(product),
        max_buy_qty: CatalogBuilder.numberOrUndefined(product.max_buy_qty),
        min_buy_qty: CatalogBuilder.numberOrUndefined(product.min_buy_qty),
        restrict_multiple: Boolean(product.restrict_multiple),
        variants,
        bundles,
        attachments,
      };
    }

    return {
      channel: { id: channelData._id ?? null, name: channelData.name ?? null, currency },
      products,
    };
  }

  /**
   * The channel's sellable subscription plans, keyed by the product and variant each one sells.
   *
   * Where two plans sell the same variant, the lower plan id wins, so a re-sync of the same plans
   * always writes the same catalog. A row missing any identifier, or whose first payment is not a
   * non-negative integer, is skipped rather than repaired: a plan the storefront cannot price is
   * one it must not sell.
   */
  private static planIndex(plans: PlanRow[]): Map<string, PlanAttachment> {
    const index = new Map<string, PlanAttachment>();

    for (const plan of plans) {
      if (!plan || typeof plan !== 'object') continue;

      const { plan_id: id, product_id: productId, variant_id: variantId, first_payment_cents: firstPayment } = plan;
      if (typeof id !== 'string' || id === '' || typeof productId !== 'string' || typeof variantId !== 'string') continue;
      if (typeof firstPayment !== 'number' || !Number.isInteger(firstPayment) || firstPayment < 0) continue;

      const key = `${productId}|${variantId}`;
      const existing = index.get(key);
      if (existing && existing.id < id) continue;

      const name = plan.display_name ?? plan.name ?? '';
      index.set(key, {
        id,
        name: typeof name === 'string' ? name : '',
        first_payment_cents: firstPayment,
        allow_coupons: plan.allow_coupons !== false,
      });
    }

    return index;
  }

  /**
   * Puts each variant the channel sells on a plan onto that plan.
   *
   * A variant on a plan is sold at the plan's first payment, which is what the EMR's own checkout
   * charges for it and what the buyer must be shown, so `price_cents` becomes that figure and the
   * variant's own price is kept beside it as `list_price_cents`. Done here, once, rather than at
   * each place a price is read, so the product page, the cart and the charge cannot disagree. A
   * deployment that sells the variant one-off instead sets `plan` to null and `price_cents` back in
   * the override layer.
   */
  private static attachPlans(variants: ProductVariant[], productId: string, planIndex: Map<string, PlanAttachment>): ProductVariant[] {
    if (planIndex.size === 0) return variants;

    return variants.map((variant) => {
      const plan = planIndex.get(`${productId}|${variant.id}`);
      if (!plan) return variant;

      return { ...variant, list_price_cents: variant.price_cents, price_cents: plan.first_payment_cents, plan };
    });
  }

  /**
   * Builds a nested labtest/add_ons entry into a standalone product and registers it in the
   * shared `products` map, deduping by slug (a deterministic function of the source `_id` + name,
   * so the same entity referenced twice always maps to the same slug) [2.14]. A nested entry
   * carries its own `product_mappings`, independent of its parent's: an add-on is a separate line
   * item at the provider, so it resolves against its own mappings and never inherits the parent's
   * offer. An entry without the key gets `provider: null` on every variant, and validation reports
   * the gap ([2.18]).
   */
  private static addNestedProduct(products: Record<string, CatalogProduct>, item: RawRecord, nestedKind: string): string {
    const slug = CatalogBuilder.makeSlug(String(item._id), String(item.name));

    if (products[slug]) {
      return slug;
    }

    let kind = nestedKind;
    const mappings = Array.isArray(item.product_mappings) ? (item.product_mappings as RawRecord[]) : [];
    const variants = CatalogBuilder.buildVariants(Array.isArray(item.variants) ? item.variants : [], item, mappings, null);

    // An add-on the channel gives a price is sold at that price, attached to its parent like a free
    // one: `free-addon` is the kind the cart forces to zero, so a priced add-on must not carry it.
    // Labs keep their kind whatever they cost.
    if (kind === 'free-addon' && (variants[0]?.price_cents ?? 0) > 0) kind = 'priced-addon';

    products[slug] = {
      slug,
      name: String(item.name),
      subtitle: null,
      kind,
      categories: CatalogBuilder.namesOf(Array.isArray(item.categories) ? item.categories : []),
      condition_treated: CatalogBuilder.namesOf(Array.isArray(item.condition_treated) ? item.condition_treated : []),
      description: CatalogBuilder.stringOr(item.description_long, CatalogBuilder.stringOr(item.description_short, '')),
      price_cents: variants[0]?.price_cents ?? 0,
      price_unit: PRICE_UNIT,
      image: PLACEHOLDER_IMAGE,
      gallery: [PLACEHOLDER_IMAGE],
      badges: [],
      emr_product_id: item._id !== undefined && item._id !== null ? String(item._id) : null,
      remote_image: typeof item.image === 'string' ? item.image : null,
      teleform_id: CatalogBuilder.firstTeleformId(item),
      max_buy_qty: CatalogBuilder.numberOrUndefined(item.max_buy_qty),
      min_buy_qty: CatalogBuilder.numberOrUndefined(item.min_buy_qty),
      restrict_multiple: Boolean(item.restrict_multiple),
      variants,
      bundles: [],
      attachments: [],
    };

    return slug;
  }

  /**
   * Rule 4 [2.15]: a product/lab/add-on with an empty `variants` list sells as a single SKU;
   * synthesize one variant from the product's own id/name/price so downstream code always sees a
   * uniform, non-empty variants list. A synthesized variant's id equals the product id, which is
   * exactly what the EMR emits as `variant_id` in `product_mappings` for single-SKU products
   * (rule 5).
   */
  private static buildVariants(variants: unknown[], product: RawRecord, mappings: RawRecord[], activeProcessorType: string | null): ProductVariant[] {
    if (variants.length === 0) {
      const id = String(product._id ?? product.product_id ?? '');
      return [
        {
          id,
          name: typeof product.name === 'string' ? product.name : '',
          price_cents: CatalogBuilder.toCents(CatalogBuilder.defaultDollarPrice(product)),
          provider: CatalogBuilder.providerFor(id, mappings, activeProcessorType),
        },
      ];
    }

    const out: ProductVariant[] = [];
    for (const raw of variants) {
      if (!raw || typeof raw !== 'object') continue;
      const variant = raw as RawRecord;
      const id = String(variant._id);
      out.push({
        id,
        // Rule 3: `default_price` is decimal dollars in the EMR; price_cents = round(dollars * 100).
        name: typeof variant.name === 'string' ? variant.name : '',
        price_cents: CatalogBuilder.toCents(variant.default_price !== undefined ? Number(variant.default_price) : null),
        provider: CatalogBuilder.providerFor(id, mappings, activeProcessorType),
      });
    }

    return out;
  }

  /**
   * Rule 5: find the `product_mappings[]` entry whose `variant_id` matches this variant's id and
   * attach its offer/product identifiers.
   *
   * **Deviates from the PHP original on purpose, after a real, live failure.** PHP's own
   * `providerFor()` (and this port's original port of it) always took the *first* matching
   * mapping, with a comment explicitly naming the exact scenario that turns out to matter: "the
   * fixture can carry more than one mapping per `variant_id` across different payment processors
   * (e.g. a vrio entry and a checkout_champ entry for the same variant)". Confirmed live against
   * the real AsterMD channel: Rameltion's variant carries exactly that — a `vrio` mapping
   * (`offer_id: "338"`) *and* a `checkout_champ` mapping (`offer_id: "457"`) — and the channel's
   * own `payment_processor.provider_category` is `checkout_champ`. Array order put `vrio` first,
   * so every real checkout attempt sent CheckoutChamp `338` (a Vrio-side id CheckoutChamp has never
   * heard of) as `campaignId`, and CheckoutChamp's real API correctly refused it ("Must provide
   * campaignId") — not a card problem, and not something a correct card could have fixed. Now
   * prefers the mapping whose own `type` matches the channel's active processor, falling back to
   * the old first-match behaviour only when none does (a channel with just one processor's mapping
   * behaves identically to before). No match at all -> null; validation reports the gap later
   * ([2.18]).
   */
  private static providerFor(variantId: string, mappings: RawRecord[], activeProcessorType: string | null): { offer_id: string; product_id: string } | null {
    const matching = mappings.filter((mapping) => mapping && typeof mapping === 'object' && String(mapping.variant_id ?? '') === variantId);

    const preferred = activeProcessorType === null ? undefined : matching.find((mapping) => mapping.type === activeProcessorType);
    const chosen = preferred ?? matching[0];
    if (chosen === undefined) return null;

    const inner = (chosen.mapping ?? {}) as RawRecord;
    return { offer_id: String(inner.offer_id), product_id: String(inner.product_id) };
  }

  /**
   * Best-effort decimal-dollar price for a product/lab/add-on that has no explicit variants
   * (rule 4, [2.15]): prefer `single[0].default_price` (standard/add_on shape), fall back to a
   * top-level `price` field (the labtest shape), else null (rendered as 0 cents by `toCents()`).
   */
  private static defaultDollarPrice(item: RawRecord): number | null {
    const single = Array.isArray(item.single) ? (item.single[0] as RawRecord | undefined) : undefined;
    if (single && single.default_price !== undefined) {
      return Number(single.default_price);
    }

    if (item.price !== undefined) {
      return Number(item.price);
    }

    return null;
  }

  /** Rule 3: decimal dollars -> integer cents. Missing price -> 0 cents. */
  private static toCents(dollars: number | null): number {
    return Math.round((dollars ?? 0) * 100);
  }

  /** Rule 2: EMR `prescription` type -> `rx`; everything else -> `otc`. */
  private static kindOf(type: unknown): string {
    return type === 'prescription' ? 'rx' : 'otc';
  }

  /**
   * Rule 9: `categories`/`condition_treated` are lists of `{_id, name}` objects in the standard
   * shape, but the add_ons fixture shape stores `condition_treated` as bare id strings with no
   * `name` — those entries are silently skipped rather than raising, since there is no name to
   * surface.
   */
  private static namesOf(items: unknown[]): string[] {
    const names: string[] = [];
    for (const item of items) {
      if (item && typeof item === 'object' && 'name' in item && typeof (item as RawRecord).name !== 'undefined') {
        names.push(String((item as RawRecord).name));
      }
    }
    return names;
  }

  /** Rule 1 [2.10]: slug = first 6 chars of the EMR `_id` + '-' + slugified name. */
  private static makeSlug(id: string, name: string): string {
    return `${id.slice(0, 6)}-${CatalogBuilder.slugify(name)}`;
  }

  /** Lowercase; any run of non-alphanumeric characters collapses to a single '-'; trim leading/trailing '-'. */
  private static slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private static firstTeleformId(product: RawRecord): string | undefined {
    const teleforms = Array.isArray(product.teleforms) ? product.teleforms : [];
    const first = teleforms[0];
    if (first && typeof first === 'object' && '_id' in (first as RawRecord)) {
      const id = (first as RawRecord)._id;
      return id !== undefined && id !== null ? String(id) : undefined;
    }
    return undefined;
  }

  private static numberOrUndefined(value: unknown): number | undefined {
    return typeof value === 'number' ? value : undefined;
  }

  private static stringOr(value: unknown, fallback: string): string {
    return typeof value === 'string' ? value : fallback;
  }
}
