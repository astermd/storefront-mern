import { Definition } from '../../src/forms/definition';
import { FieldViewModel } from '../../src/forms/field-view-model';
import { RuleEvaluator } from '../../src/forms/rule-evaluator';

/**
 * A button field holding the builder's Back-beside-Next row (lamp 4e32b5e): `buttonCount` switches
 * the second button on, and a second button with no label of its own is named by what it does.
 */
function buttonView(properties: Record<string, unknown>, label = 'Back'): Record<string, unknown> {
  const definition = Definition.fromArray({ pages: [{ pageId: 'p1', order: 1, fields: [{ name: 'nav', type: 'button', label, order: 1, properties }] }] });
  const field = definition.pages()[0].fields[0];

  return FieldViewModel.for(field, new RuleEvaluator().state(field, {}, definition), null, null);
}

describe('two-button intake field', () => {
  it('renders the authored second button', () => {
    expect(buttonView({ buttonAction: 'previous_page', buttonCount: 2, secondaryButtonLabel: 'Continue', secondaryButtonAction: 'next_page' })).toMatchObject({
      button_action: 'previous_page',
      secondary_label: 'Continue',
      secondary_action: 'next_page',
    });
  });

  it('accepts the count as a numeric string', () => {
    expect(buttonView({ buttonAction: 'previous_page', buttonCount: '2', secondaryButtonLabel: 'Next', secondaryButtonAction: 'next_page' }).secondary_label).toBe('Next');
  });

  it.each([
    ['next_page', 'Next'],
    ['submit', 'Submit'],
    ['previous_page', 'Back'],
  ])('names an unlabelled second button by its action (%s)', (action, label) => {
    expect(buttonView({ buttonAction: 'previous_page', buttonCount: 2, secondaryButtonAction: action })).toMatchObject({ secondary_label: label, secondary_action: action });
  });

  it('ignores secondary keys the builder left behind after the count dropped to one', () => {
    expect(buttonView({ buttonAction: 'next_page', buttonCount: 1, secondaryButtonLabel: 'Back', secondaryButtonAction: 'previous_page' }, 'Next')).toMatchObject({
      secondary_label: null,
      secondary_action: null,
    });
  });
});
