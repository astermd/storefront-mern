import { AnswerSet } from '../../src/forms/answer-set';
import { Definition } from '../../src/forms/definition';
import { TeleformMetadata } from '../../src/forms/teleform-metadata';
import { Prefill } from '../../src/checkout/prefill';

/**
 * End-to-end regression for the fieldId/name mismatch fixed in `Definition.resolveDbFields()`
 * (see definition.spec.ts): a real teleform's `db_fields` keys are fieldIds, and `Prefill.from()`
 * used to look answers up by that raw key directly, so checkout's email/first-name fields never
 * prefilled from a real intake answer even though the mapping and the answer both existed.
 */
describe('Prefill.from() against a real-shaped fieldId-keyed db_fields map', () => {
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

  const metadata = new TeleformMetadata('tf1', 'ident-1', 'intake', 'single-column', {
    'text-1786002009432-697': 'opportunity.first_name',
    'email-1771481017899-166': 'opportunity.email',
  });

  it('prefills checkout fields from answers stored under the short field name', () => {
    const answers = AnswerSet.fromArray({ text_1786002009: 'Jane Tester', email_12: 'jane@example.com' });

    const prefilled = Prefill.from(metadata, definition, answers, {});

    expect(prefilled.first_name).toBe('Jane Tester');
    expect(prefilled.email).toBe('jane@example.com');
  });

  it('falls back to working state alone when no definition is available', () => {
    const prefilled = Prefill.from(metadata, null, AnswerSet.fromArray({ text_1786002009: 'Jane Tester' }), { email: 'typed@example.com' });

    expect(prefilled.first_name).toBeUndefined();
    expect(prefilled.email).toBe('typed@example.com');
  });
});
