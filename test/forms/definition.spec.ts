import { Definition } from '../../src/forms/definition';

/**
 * A real live teleform's `db_fields` keys its map by each field's long-form `fieldId`
 * (`text-1786002009432-697`), not by the short `name` (`text_1786002009`) every answer is
 * actually stored and posted under. `RecordMapper`/`Prefill`/`VerificationStep.dob()` all used to
 * read `db_fields`'s own key straight into `AnswerSet.value()`, which never matched anything —
 * silently dropping every mapped answer (name, email, DOB, height, weight, gender) from both the
 * EMR record write and checkout/verification prefill. Confirmed live against the real AsterMD
 * dev-sandbox teleform for Rameltion.
 */
describe('Definition.resolveDbFields()', () => {
  const definition = Definition.fromArray({
    pages: [
      {
        pageId: 'p1',
        order: 1,
        fields: [
          { fieldId: 'text-1786002009432-697', name: 'text_1786002009', type: 'text', label: 'Name', order: 1 },
          { fieldId: 'email-1771481017899-166', name: 'email_12', type: 'email', label: 'Email', order: 2 },
        ],
      },
    ],
  });

  it('re-keys a db_fields map keyed by fieldId to the field\'s own answer name', () => {
    const resolved = definition.resolveDbFields({
      'text-1786002009432-697': 'opportunity.first_name',
      'email-1771481017899-166': 'opportunity.email',
    });

    expect(resolved).toEqual({
      text_1786002009: 'opportunity.first_name',
      email_12: 'opportunity.email',
    });
  });

  it('leaves a key unchanged when no field carries it as a fieldId (already an answer name)', () => {
    const resolved = definition.resolveDbFields({ text_1786002009: 'opportunity.first_name' });
    expect(resolved).toEqual({ text_1786002009: 'opportunity.first_name' });
  });
});
