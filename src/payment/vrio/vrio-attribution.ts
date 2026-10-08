/**
 * Ported from storefront-lamp/core/Payment/Vrio/VrioAttribution.php. Maps this port's canonical
 * attribution keys onto Vrio's twenty numbered `trackingN` slots.
 */
export class VrioAttribution {
  private static readonly SLOTS: Record<string, number> = {
    affiliate_id: 1,
    c1: 2,
    c2: 3,
    c3: 4,
    c4: 5,
    c5: 6,
    c6: 7,
    c7: 8,
    c8: 9,
    c9: 10,
    c10: 11,
    c11: 12,
    c12: 13,
    c13: 14,
    utm_source: 15,
    utm_medium: 16,
    utm_campaign: 17,
    utm_term: 18,
    utm_content: 19,
    c14: 20,
  };

  /** @returns [slots to spread into the order payload, keys with no known slot] */
  static map(attribution: Record<string, unknown>): [Record<string, string>, string[]] {
    const slots: Record<string, string> = {};
    const dropped: string[] = [];

    for (const [key, rawValue] of Object.entries(attribution)) {
      const value = String(rawValue ?? '').trim();
      if (value === '') continue;

      const slot = VrioAttribution.SLOTS[key];
      if (slot === undefined) {
        dropped.push(key);
        continue;
      }

      slots[`tracking${slot}`] = value;
    }

    return [slots, dropped];
  }
}
