import { AnswerEncoder } from '../../src/forms/answer-encoder';
import { AnswerSet } from '../../src/forms/answer-set';
import { Definition } from '../../src/forms/definition';

/**
 * `sendToProvider: false` governs whether `RecordMapper` writes a field into the EMR's clinical
 * record — it gates on `db_field` there instead — and has no bearing on the visitor's own
 * in-progress intake draft, which is what `AnswerEncoder` feeds. Regression coverage for the fix
 * that stopped this encoder excluding such a field from the draft.
 */
describe('AnswerEncoder — sendToProvider does not gate the intake draft', () => {
  it('excludes the display-only element but keeps a field marked sendToProvider: false', () => {
    const definition = Definition.fromArray({
      pages: [
        {
          pageId: 'p1',
          order: 1,
          fields: [
            { fieldId: 'notice', name: 'notice', type: 'alert', label: 'Notice', order: 1 },
            { fieldId: 'utm', name: 'utm', type: 'hidden', label: 'Campaign', order: 2, sendToProvider: false },
            { fieldId: 'first_name', name: 'first_name', type: 'text', label: 'First name', order: 3 },
          ],
        },
      ],
    });

    const encoded = AnswerEncoder.encode(
      definition,
      AnswerSet.fromArray({ notice: 'shown', utm: 'spring', first_name: 'Dana' }),
    );

    expect(encoded.map((entry) => entry.name)).toEqual(['utm', 'first_name']);
  });
});
