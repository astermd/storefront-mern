/**
 * Ported from storefront-lamp/core/Seo/StructuredData/Emitter.php. One schema.org node, built from
 * catalog and configuration data (`[24.8]`).
 *
 * There is an emitter per type rather than one class that switches on a type string, because each
 * type answers to a different rule: the offer inside a `Product` has to reflect real state
 * (`[24.9]`), a prescription product has to be able to publish nothing at all (`[24.10]`), and the
 * site-level nodes have neither constraint.
 */
export interface Emitter {
  /**
   * The node, or null when this deployment publishes nothing for it. Null rather than an empty
   * object because "nothing to say" and "an empty object" are different claims to a crawler.
   */
  emit(): Record<string, unknown> | null;
}
