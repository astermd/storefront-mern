import { Field } from './field';
import { Page } from './page';

/**
 * Ported from storefront-lamp/core/Forms/Definition.php. A parsed teleform definition: the pages
 * that become steps, the settings the form author chose, and two lookup tables over every field
 * it declares.
 *
 * The lookups are built over a **flattened** field list that includes subfields, because a
 * composite's parts are independently answerable and independently mappable (`[10.7]`). A
 * subfield that could not be found by name would be a subfield that never receives its `db_fields`
 * target — the BMI composite's height and weight are exactly that case.
 *
 * Pages are ordered by their authored `order` rather than by array position, since the authoring
 * UI reorders by rewriting that number and leaves the array alone.
 */
export class Definition {
  private readonly byName = new Map<string, Field>();
  private readonly byId = new Map<string, Field>();
  private readonly flattened: Field[] = [];

  private constructor(
    private readonly settings: Record<string, unknown>,
    private readonly pagesList: Page[],
  ) {
    for (const page of pagesList) {
      for (const field of page.fields) {
        for (const entry of Definition.withSubfields(field)) {
          this.flattened.push(entry);
          // First occurrence wins: a repeated name is an authoring error, and the field the
          // renderer draws first is the one whose answer the visitor will have supplied.
          if (!this.byName.has(entry.name)) this.byName.set(entry.name, entry);
          if (!this.byId.has(entry.id)) this.byId.set(entry.id, entry);
        }
      }
    }
  }

  static fromArray(raw: Record<string, unknown>): Definition {
    const pages: Page[] = [];
    for (const page of Array.isArray(raw.pages) ? raw.pages : []) {
      if (page && typeof page === 'object') {
        pages.push(Page.fromArray(page as Record<string, unknown>));
      }
    }

    pages.sort((a, b) => a.order - b.order);

    return new Definition(raw.settings && typeof raw.settings === 'object' ? (raw.settings as Record<string, unknown>) : {}, pages);
  }

  pages(): Page[] {
    return this.pagesList;
  }

  pageCount(): number {
    return this.pagesList.length;
  }

  /** Every declared field, subfields included, in page-then-authored order. */
  fields(): Field[] {
    return this.flattened;
  }

  field(name: string): Field | null {
    return this.byName.get(name) ?? null;
  }

  fieldById(fieldId: string): Field | null {
    return this.byId.get(fieldId) ?? null;
  }

  /**
   * `TeleformMetadata.dbFields`, re-keyed by each field's answer `name` rather than whatever key
   * the raw `db_fields` map actually used. A real teleform's `db_fields` is keyed by the field's
   * long-form `fieldId` (`text-1786002009432-697`), not the short `name` (`text_1786002009`) every
   * answer is actually stored and posted under (`AnswerSet`, the HTML `name` attribute) — confirmed
   * against a live AsterMD teleform. `RecordMapper`/`Prefill`/`VerificationStep.dob()` all used to
   * read `db_fields`' own key straight into `AnswerSet.value()`, which never matched anything, so a
   * real submission's mapped name/email/DOB/height/weight/gender silently never reached the EMR
   * record and checkout/verification prefill silently never populated. A key already shaped like a
   * `name` (no matching fieldId) is kept as-is, so a teleform that genuinely keys `db_fields` by
   * name — matching this class's original assumption — still works unchanged.
   */
  resolveDbFields(dbFields: Record<string, string>): Record<string, string> {
    const resolved: Record<string, string> = {};
    for (const [key, target] of Object.entries(dbFields)) {
      resolved[this.fieldById(key)?.name ?? key] = target;
    }
    return resolved;
  }

  /**
   * The distinct types this renderer does not implement, in the order they are first met — so the
   * message an operator reads names the field they will find first when they open the form
   * (`[10.13]`).
   */
  unsupportedTypes(collectsFiles = true): string[] {
    const unsupported: string[] = [];
    for (const field of this.flattened) {
      if (!field.isSupported(collectsFiles) && !unsupported.includes(field.type)) {
        unsupported.push(field.type);
      }
    }
    return unsupported;
  }

  /** Reads a setting by dotted path, the way `Config.get()` reads config. */
  setting(key: string, defaultValue: unknown = null): unknown {
    let node: unknown = this.settings;
    for (const segment of key.split('.')) {
      if (typeof node !== 'object' || node === null || Array.isArray(node) || !(segment in node)) {
        return defaultValue;
      }
      node = (node as Record<string, unknown>)[segment];
    }
    return node;
  }

  private static withSubfields(field: Field): Field[] {
    const fields = [field];
    for (const subfield of field.subfields) {
      fields.push(...Definition.withSubfields(subfield));
    }
    return fields;
  }
}
