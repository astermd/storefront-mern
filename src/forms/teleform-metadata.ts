/**
 * Ported from storefront-lamp/core/Forms/TeleformMetadata.php. The teleform record, reduced to the
 * four things the storefront needs.
 *
 * `dbFields` is the answer-to-record mapping (`[11.1]`) — authored alongside the form, so the
 * storefront hardcodes no question-to-field mapping. It is taken from here rather than from each
 * field's own declaration because only this map reaches a composite's subfields: a BMI field's
 * height and weight have targets (`opportunity.clinical.height.value`) that the parent field's
 * single declaration cannot express.
 */
export class TeleformMetadata {
  constructor(
    public readonly id: string,
    public readonly identifier: string,
    public readonly type: string,
    public readonly layout: string,
    /** answer field name -> dotted target path on the EMR record */
    public readonly dbFields: Record<string, string>,
  ) {}

  /** @param payload the `teleforms().view()` data block */
  static fromPayload(teleformId: string, payload: Record<string, unknown>): TeleformMetadata | null {
    const identifier = payload.form_json_identifier;
    if (typeof identifier !== 'string' || identifier === '') {
      return null;
    }

    const dbFields: Record<string, string> = {};
    const rawDbFields = payload.db_fields;
    if (rawDbFields && typeof rawDbFields === 'object') {
      for (const [name, target] of Object.entries(rawDbFields as Record<string, unknown>)) {
        if (typeof target === 'string' && target !== '') {
          dbFields[name] = target;
        }
      }
    }

    return new TeleformMetadata(
      teleformId,
      identifier,
      typeof payload.type === 'string' ? payload.type : 'intake',
      typeof payload.layout === 'string' ? payload.layout : 'single-column',
      dbFields,
    );
  }
}
