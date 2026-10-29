import { FieldTypes } from './field-types';

export interface FieldOption {
  value: string;
  label: string;
}

/**
 * Ported from storefront-lamp/core/Forms/Field.php. One authored field, as the definition
 * declares it.
 *
 * A field may declare **subfields** (`[10.7]`): the composite and each of its parts are
 * independently answerable and independently mappable, which is why subfields are parsed into
 * `Field` objects of their own rather than left as raw objects. A subfield names itself with
 * `subfieldId` where a top-level field uses `fieldId`; both land in `id`.
 */
export class Field {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly label: string,
    public readonly type: string,
    public readonly description: string | null,
    public readonly placeholder: string | null,
    public readonly order: number,
    public readonly required: boolean,
    public readonly hidden: boolean,
    public readonly disabled: boolean,
    public readonly readOnly: boolean,
    public readonly sendToProvider: boolean,
    public readonly validation: Record<string, unknown>,
    public readonly conditions: Record<string, unknown>[],
    public readonly properties: Record<string, unknown>,
    public readonly subfields: Field[],
  ) {}

  static fromArray(raw: Record<string, unknown>): Field {
    const subfields: Field[] = [];
    for (const subfield of Array.isArray(raw.subfields) ? raw.subfields : []) {
      if (subfield && typeof subfield === 'object') {
        subfields.push(Field.fromArray(subfield as Record<string, unknown>));
      }
    }

    const id = raw.fieldId ?? raw.subfieldId ?? null;
    const name = raw.name ?? id ?? '';

    return new Field(
      String(id ?? name),
      String(name),
      typeof raw.label === 'string' ? raw.label : '',
      typeof raw.type === 'string' ? raw.type : '',
      Field.text(raw.description),
      Field.text(raw.placeholder),
      typeof raw.order === 'number' ? raw.order : Number(raw.order ?? 0) || 0,
      raw.required === true,
      raw.hidden === true,
      raw.disabled === true,
      raw.readOnly === true,
      // Absent means "send it": the flag exists to suppress a field, and a form that never sets
      // it expects every answer to be forwarded.
      raw.sendToProvider !== false,
      raw.validation && typeof raw.validation === 'object' ? (raw.validation as Record<string, unknown>) : {},
      Array.isArray(raw.conditions) ? raw.conditions.filter((c): c is Record<string, unknown> => c !== null && typeof c === 'object') : [],
      raw.properties && typeof raw.properties === 'object' ? (raw.properties as Record<string, unknown>) : {},
      subfields,
    );
  }

  /**
   * Choice options, normalised out of the two shapes a definition may use (`[10.9]`): a plain
   * string, which is both value and label, or an object carrying them separately.
   */
  options(): FieldOption[] {
    const raw = this.properties.options;
    const options: FieldOption[] = [];
    for (const option of Array.isArray(raw) ? raw : []) {
      if (option && typeof option === 'object') {
        const o = option as Record<string, unknown>;
        const value = o.value ?? o.label ?? '';
        const label = o.label ?? o.value ?? '';
        options.push({ value: String(value), label: String(label) });
      } else {
        options.push({ value: String(option), label: String(option) });
      }
    }
    return options;
  }

  isDisplayOnly(): boolean {
    return FieldTypes.isDisplayOnly(this.type);
  }

  /**
   * Whether this field's answer is a list rather than a scalar (`[10.36]`).
   *
   * The type is necessary and not sufficient — the EMR authors every choice question as
   * `choice-multi`, and puts the single-vs-multi distinction in `properties`: `multiSelect` says
   * whether more than one answer is allowed, `choiceInputType` says which control the author drew.
   * `multiSelect` wins when present; `choiceInputType` is consulted only as a fallback. A field
   * declaring neither stays multi.
   */
  isMultiValue(): boolean {
    if (!FieldTypes.isMultiValue(this.type)) return false;

    const multiSelect = this.properties.multiSelect;
    if (typeof multiSelect === 'boolean') return multiSelect;

    return this.properties.choiceInputType !== 'radio';
  }

  isBoolean(): boolean {
    return FieldTypes.isBoolean(this.type);
  }

  isSupported(collectsFiles = true): boolean {
    return FieldTypes.supported(this.type, collectsFiles);
  }

  isFileUpload(): boolean {
    return this.type === FieldTypes.FILE_UPLOAD;
  }

  isSignature(): boolean {
    return this.type === FieldTypes.SIGNATURE;
  }

  /** The authored column span that drives layout (`[25.7]`), never narrower than one column. */
  cols(): number {
    return Math.max(1, Number(this.properties.cols ?? 1) || 1);
  }

  private static text(value: unknown): string | null {
    return typeof value === 'string' && value !== '' ? value : null;
  }
}
