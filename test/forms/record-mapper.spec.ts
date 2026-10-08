import { AnswerSet } from '../../src/forms/answer-set';
import { Definition } from '../../src/forms/definition';
import { RecordMapper } from '../../src/forms/record-mapper';
import { TeleformMetadata } from '../../src/forms/teleform-metadata';
import { OperatorLog } from '../../src/support/operator-log';

function mapper(): RecordMapper {
  return new RecordMapper(new OperatorLog('/dev/null'));
}

function metadata(dbFields: Record<string, string>): TeleformMetadata {
  return new TeleformMetadata('tf1', 'form-1', 'intake', 'single-column', dbFields);
}

const definition = Definition.fromArray({
  pages: [
    {
      pageId: 'p1',
      order: 1,
      fields: [
        { fieldId: 'other_medications_details', name: 'other_medications_details', type: 'text', label: 'Medications', order: 1 },
        { fieldId: 'known_allergies_details', name: 'known_allergies_details', type: 'text', label: 'Allergies', order: 2 },
      ],
    },
  ],
});

/**
 * The EMR refuses `clinical.medications` and `clinical.allergies` written as a bare string.
 * Wrapping the whole free-text answer in a single-element list is the safe conversion — splitting
 * on commas would guess at a delimiter the visitor never agreed to.
 */
describe('RecordMapper — medications/allergies list targets', () => {
  it('writes a single free-text answer to clinical.medications as a one-element list, not a bare string', () => {
    const payload = mapper().build(
      metadata({ other_medications_details: 'opportunity.clinical.medications' }),
      AnswerSet.fromArray({ other_medications_details: 'metformin' }),
      definition,
    );

    expect(payload).toEqual({ clinical: { medications: ['metformin'] } });
  });

  it('wraps the whole free-text answer rather than splitting it on commas', () => {
    const payload = mapper().build(
      metadata({
        other_medications_details: 'opportunity.clinical.medications',
        known_allergies_details: 'opportunity.clinical.allergies',
      }),
      AnswerSet.fromArray({
        other_medications_details: 'GLP1, metformin',
        known_allergies_details: 'Almond',
      }),
      definition,
    );

    expect(payload).toEqual({
      clinical: { medications: ['GLP1, metformin'], allergies: ['Almond'] },
    });
  });
});
