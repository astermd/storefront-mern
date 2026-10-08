import { Definition } from '../../src/forms/definition';
import { Field } from '../../src/forms/field';
import { FieldViewModel } from '../../src/forms/field-view-model';
import { RuleEvaluator } from '../../src/forms/rule-evaluator';

function viewModel(raw: Record<string, unknown>, answer: unknown = null, error: string | null = null): Record<string, unknown> {
  const definition = Definition.fromArray({ pages: [{ pageId: 'p1', order: 0, fields: [raw] }] });
  const field = definition.field(raw.name as string) as Field;

  return FieldViewModel.for(field, new RuleEvaluator().state(field, {}, definition), answer, error);
}

describe('FieldViewModel — properties.hidden', () => {
  it('renders a field marked hidden in properties as a native hidden input', () => {
    const model = viewModel({
      fieldId: 'last_name', name: 'last_name', type: 'text', label: 'Last Name',
      properties: { hidden: true },
    });

    expect(model.input_type).toBe('hidden');
    expect(model.template).toBe('field-text');
  });

  it('keeps a field with no hidden property at its ordinary input type', () => {
    expect(viewModel({ fieldId: 'a', name: 'a', type: 'text', label: 'A' }).input_type).toBe('text');
  });
});

describe('FieldViewModel — properties.hasDefaultValue', () => {
  it('fills an unanswered field with its declared default', () => {
    const model = viewModel({
      fieldId: 'bmi_height_unit', name: 'bmi_height_unit', type: 'text', label: 'height_unit',
      properties: { hidden: true, hasDefaultValue: true, defaultValue: 'in' },
    });

    expect(model.value).toBe('in');
  });

  it('keeps a visitor\'s own answer, even an empty one, over the declared default', () => {
    const model = viewModel(
      { fieldId: 'a', name: 'a', type: 'text', label: 'A', properties: { hasDefaultValue: true, defaultValue: 'in' } },
      'cm',
    );

    expect(model.value).toBe('cm');
  });

  it('leaves a field with no declared default unaffected', () => {
    expect(viewModel({ fieldId: 'a', name: 'a', type: 'text', label: 'A' }).value).toBe('');
  });

  it('marks a choice field\'s option selected from the declared default', () => {
    const model = viewModel({
      fieldId: 'age_confirmation', name: 'age_confirmation', type: 'choice-multi', label: 'Age',
      properties: {
        options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
        choiceInputType: 'radio',
        multiSelect: false,
        hasDefaultValue: true,
        defaultValue: 'yes',
      },
    });

    const options = model.options as { value: string; selected: boolean }[];
    expect(options[0].selected).toBe(true);
    expect(options[1].selected).toBe(false);
  });
});
