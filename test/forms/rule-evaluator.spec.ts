import { Definition } from '../../src/forms/definition';
import { Field } from '../../src/forms/field';
import { RuleEvaluator } from '../../src/forms/rule-evaluator';

function field(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    fieldId: 'f1',
    name: 'f1',
    label: 'Field One',
    type: 'text',
    order: 1,
    ...overrides,
  };
}

function definitionWith(fields: Record<string, unknown>[]): Definition {
  return Definition.fromArray({ pages: [{ pageId: 'p1', order: 1, fields }] });
}

describe('RuleEvaluator.rule()', () => {
  const evaluator = new RuleEvaluator();

  it('an absent operator means equals', () => {
    const subject = Field.fromArray(field({ name: 'phone_status' }));
    expect(evaluator.rule({ field: 'phone_status', value: 'yes' }, { phone_status: 'yes' }, subject)).toBe(true);
    expect(evaluator.rule({ field: 'phone_status', value: 'no' }, { phone_status: 'yes' }, subject)).toBe(false);
  });

  it('an unrecognised operator evaluates false rather than throwing', () => {
    const subject = Field.fromArray(field());
    expect(evaluator.rule({ field: 'f1', operator: 'nonsense', value: 'x' }, { f1: 'x' }, subject)).toBe(false);
  });

  it('a null subject (field not declared) evaluates false even when an answer exists under the name', () => {
    expect(evaluator.rule({ field: 'orphaned', operator: 'equals', value: 'x' }, { orphaned: 'x' }, null)).toBe(false);
  });

  it('camelCase operator aliases resolve to their canonical snake_case form', () => {
    const subject = Field.fromArray(field());
    expect(evaluator.rule({ field: 'f1', operator: 'notEquals', value: 'a' }, { f1: 'b' }, subject)).toBe(true);
    expect(evaluator.rule({ field: 'f1', operator: 'isEmpty' }, { f1: '' }, subject)).toBe(true);
  });

  it('is_empty/is_not_empty: a "0" string is a real answer, not empty', () => {
    const subject = Field.fromArray(field());
    expect(evaluator.rule({ field: 'f1', operator: 'is_empty' }, { f1: '0' }, subject)).toBe(false);
    expect(evaluator.rule({ field: 'f1', operator: 'is_not_empty' }, { f1: '0' }, subject)).toBe(true);
  });

  it('numeric comparisons coerce both sides', () => {
    const subject = Field.fromArray(field());
    expect(evaluator.rule({ field: 'f1', operator: 'greater_than', value: '10' }, { f1: '27' }, subject)).toBe(true);
    expect(evaluator.rule({ field: 'f1', operator: 'less_than', value: '27' }, { f1: '10' }, subject)).toBe(true);
    expect(evaluator.rule({ field: 'f1', operator: 'less_than', value: '10' }, { f1: 'not-a-number' }, subject)).toBe(false);
  });

  it('list-valued answers use membership semantics against stored values, not labels', () => {
    const subject = Field.fromArray(
      field({ type: 'choice-multi', properties: { multiSelect: true, options: [{ value: 'none-of-the-above', label: 'None of the above' }] } }),
    );
    expect(
      evaluator.rule({ field: 'f1', operator: 'contains', value: 'None of the above' }, { f1: ['none-of-the-above'] }, subject),
    ).toBe(false);
    expect(
      evaluator.rule({ field: 'f1', operator: 'contains', value: 'none-of-the-above' }, { f1: ['none-of-the-above'] }, subject),
    ).toBe(true);
  });

  it('phone fields normalise both sides to the last 10 digits', () => {
    const subject = Field.fromArray(field({ type: 'phone' }));
    expect(evaluator.rule({ field: 'f1', operator: 'equals', value: '+1 (555) 123-4567' }, { f1: '5551234567' }, subject)).toBe(true);
  });

  it('booleans stringify as true/false, matching what the engine would stringify', () => {
    const subject = Field.fromArray(field({ type: 'checkbox' }));
    expect(evaluator.rule({ field: 'f1', operator: 'equals', value: 'true' }, { f1: true }, subject)).toBe(true);
  });
});

describe('RuleEvaluator.group()', () => {
  const evaluator = new RuleEvaluator();

  it('an empty rule list is not satisfied', () => {
    const definition = definitionWith([field()]);
    expect(evaluator.group({ rules: [] }, {}, definition)).toBe(false);
  });

  it('logic[i-1] joins the accumulated result with rule i — one shorter than the rule list', () => {
    const definition = definitionWith([field({ fieldId: 'a', name: 'a' }), field({ fieldId: 'b', name: 'b', order: 2 })]);
    const condition = {
      logic: ['and'],
      rules: [
        { field: 'a', operator: 'equals', value: '1' },
        { field: 'b', operator: 'equals', value: '2' },
      ],
    };
    expect(evaluator.group(condition, { a: '1', b: '2' }, definition)).toBe(true);
    expect(evaluator.group(condition, { a: '1', b: 'x' }, definition)).toBe(false);
  });

  it('a bare string logic applies to every join', () => {
    const definition = definitionWith([
      field({ fieldId: 'a', name: 'a' }),
      field({ fieldId: 'b', name: 'b', order: 2 }),
      field({ fieldId: 'c', name: 'c', order: 3 }),
    ]);
    const condition = {
      logic: 'or',
      rules: [
        { field: 'a', operator: 'equals', value: '1' },
        { field: 'b', operator: 'equals', value: '2' },
        { field: 'c', operator: 'equals', value: '3' },
      ],
    };
    expect(evaluator.group(condition, { a: 'no', b: 'no', c: '3' }, definition)).toBe(true);
    expect(evaluator.group(condition, { a: 'no', b: 'no', c: 'no' }, definition)).toBe(false);
  });
});

describe('RuleEvaluator.state()', () => {
  const evaluator = new RuleEvaluator();

  it('a field carrying a show condition starts invisible (inverted default)', () => {
    const target = field({
      fieldId: 'target',
      name: 'target',
      conditions: [{ action: 'show', rules: [{ field: 'trigger', operator: 'equals', value: 'yes' }] }],
    });
    const definition = definitionWith([field({ fieldId: 'trigger', name: 'trigger' }), target]);
    const targetField = definition.field('target')!;

    expect(evaluator.state(targetField, { trigger: 'no' }, definition).visible).toBe(false);
    expect(evaluator.state(targetField, { trigger: 'yes' }, definition).visible).toBe(true);
  });

  it('a field carrying an enable condition starts disabled (inverted default)', () => {
    const target = field({
      fieldId: 'target',
      name: 'target',
      conditions: [{ action: 'enable', rules: [{ field: 'trigger', operator: 'equals', value: 'yes' }] }],
    });
    const definition = definitionWith([field({ fieldId: 'trigger', name: 'trigger' }), target]);
    const targetField = definition.field('target')!;

    expect(evaluator.state(targetField, { trigger: 'no' }, definition).disabled).toBe(true);
    expect(evaluator.state(targetField, { trigger: 'yes' }, definition).disabled).toBe(false);
  });

  it('the last matching condition wins — a broad show under a narrower hide', () => {
    const target = field({
      fieldId: 'target',
      name: 'target',
      conditions: [
        { action: 'show', rules: [{ field: 'a', operator: 'equals', value: '1' }] },
        { action: 'hide', rules: [{ field: 'b', operator: 'equals', value: '1' }] },
      ],
    });
    const definition = definitionWith([field({ fieldId: 'a', name: 'a' }), field({ fieldId: 'b', name: 'b', order: 2 }), target]);
    const targetField = definition.field('target')!;

    expect(evaluator.state(targetField, { a: '1', b: '1' }, definition).visible).toBe(false);
    expect(evaluator.state(targetField, { a: '1', b: '0' }, definition).visible).toBe(true);
  });

  it('an invisible or disabled field is forced non-required', () => {
    const target = field({
      fieldId: 'target',
      name: 'target',
      required: true,
      conditions: [{ action: 'show', rules: [{ field: 'trigger', operator: 'equals', value: 'yes' }] }],
    });
    const definition = definitionWith([field({ fieldId: 'trigger', name: 'trigger' }), target]);
    const targetField = definition.field('target')!;

    expect(evaluator.state(targetField, { trigger: 'no' }, definition).required).toBe(false);
  });

  it('a field with no conditions keeps its authored flags', () => {
    const definition = definitionWith([field({ required: true })]);
    const targetField = definition.field('f1')!;
    const state = evaluator.state(targetField, {}, definition);
    expect(state).toEqual({ visible: true, disabled: false, required: true });
  });
});
