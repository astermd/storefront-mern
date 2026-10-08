import { Field } from './field';

/**
 * Ported from storefront-lamp/core/Forms/Page.php. One page of a definition, which is one step of
 * the form (`[10.5]`).
 *
 * Only top-level fields are listed here; a composite's subfields hang off their parent `Field`.
 * `Definition.fields()` is the flattened view for anything that needs every answerable field at
 * once.
 */
export class Page {
  constructor(
    public readonly id: string,
    public readonly title: string | null,
    public readonly description: string | null,
    public readonly order: number,
    public readonly fields: Field[],
  ) {}

  static fromArray(raw: Record<string, unknown>): Page {
    const fields: Field[] = [];
    for (const field of Array.isArray(raw.fields) ? raw.fields : []) {
      if (field && typeof field === 'object') {
        fields.push(Field.fromArray(field as Record<string, unknown>));
      }
    }

    return new Page(
      String(raw.pageId ?? ''),
      typeof raw.title === 'string' && raw.title !== '' ? raw.title : null,
      typeof raw.description === 'string' && raw.description !== '' ? raw.description : null,
      typeof raw.order === 'number' ? raw.order : Number(raw.order ?? 0) || 0,
      fields,
    );
  }
}
