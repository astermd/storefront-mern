import { AnswerEncoder } from '../../src/forms/answer-encoder';
import { AnswerSet } from '../../src/forms/answer-set';
import { AnswerValidator } from '../../src/forms/answer-validator';
import { Definition } from '../../src/forms/definition';
import { FieldTypes } from '../../src/forms/field-types';
import { RuleEvaluator } from '../../src/forms/rule-evaluator';
import { OperatorLog } from '../../src/support/operator-log';

/**
 * Ported from the file-upload / signature cases lamp 0.0.6 added to AnswerSetTest, AnswerValidatorTest,
 * AnswerEncoder, DefinitionTest and FieldTypesTest.
 */
const SESSION = '550e8400-e29b-41d4-a716-446655440000';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const file = (n: number) => ({ path: `a/b/intake_submissions/${SESSION}/f${n}.pdf`, name: `f${n}.pdf`, mime_type: 'application/pdf' });

function definition(fields: Record<string, unknown>[]): Definition {
  return Definition.fromArray({ pages: [{ pageId: 'p1', order: 0, fields }] });
}

const form = definition([
  { fieldId: 'labs', name: 'labs', type: 'file-upload', label: 'Labs' },
  { fieldId: 'sig', name: 'sig', type: 'signature', label: 'Signature' },
]);

describe('file-upload answers', () => {
  it('stores one reference per attached file and ignores the blank entry', () => {
    const labs = file(1);

    const answers = AnswerSet.empty().merge({ labs: ['', JSON.stringify(labs), JSON.stringify(labs), '{"path":"../../etc/passwd"}', 'not json'] }, form);

    expect(answers.value('labs')).toEqual([labs]);
  });

  it('a lone empty entry clears the answer', () => {
    const answers = AnswerSet.fromArray({ labs: [file(1)] }).merge({ labs: [''] }, form);

    expect(answers.value('labs')).toEqual([]);
  });

  it('a signature is kept only as a PNG data URL', () => {
    expect(AnswerSet.empty().merge({ sig: PNG }, form).value('sig')).toBe(PNG);
    expect(AnswerSet.empty().merge({ sig: 'data:text/html;base64,PHNjcmlwdD4=' }, form).value('sig')).toBe('');
    expect(AnswerSet.empty().merge({ sig: 'https://example.com/sig.png' }, form).value('sig')).toBe('');
    expect(AnswerSet.empty().merge({ sig: 'data:image/png;base64,' + 'A'.repeat(1024 * 1024) }, form).value('sig')).toBe('');
  });

  it('a file question holding more files than it takes is rejected', () => {
    const labs = definition([
      { fieldId: 'labs', name: 'labs', type: 'file-upload', label: 'Labs', properties: { allowMultipleFiles: true, maxFiles: 2 } },
    ]);
    const validator = new AnswerValidator(new RuleEvaluator(new OperatorLog('/dev/null')));

    expect(validator.validate(labs, AnswerSet.fromArray({ labs: [file(1), file(2)] }), null)).toEqual({});
    expect(validator.validate(labs, AnswerSet.fromArray({ labs: [file(1), file(2), file(3)] }), null)).toEqual({ labs: 'Labs takes at most 2 files.' });
  });

  it('a required file question with no file is unanswered', () => {
    const required = definition([{ fieldId: 'labs', name: 'labs', type: 'file-upload', label: 'Labs', required: true }]);
    const validator = new AnswerValidator(new RuleEvaluator(new OperatorLog('/dev/null')));

    expect(Object.keys(validator.validate(required, AnswerSet.fromArray({ labs: [] }), null))).toEqual(['labs']);
    expect(validator.validate(required, AnswerSet.fromArray({ labs: [file(1)] }), null)).toEqual({});
  });

  it('a submission sends the files and the signature under the file type', () => {
    const answers = AnswerSet.fromArray({ labs: [file(1), file(2)], sig: PNG });

    const encoded = AnswerEncoder.encode(form, answers);

    expect(encoded.map((entry) => [entry.name, entry.type])).toEqual([
      ['labs', FieldTypes.SUBMITTED_FILE_TYPE],
      ['sig', FieldTypes.SUBMITTED_FILE_TYPE],
    ]);
    expect(encoded[0].value).toEqual([{ value: file(1) }, { value: file(2) }]);
    expect(encoded[1].value).toEqual([{ value: PNG }]);
  });
});

describe('file types and renderers', () => {
  it('both are supported by default, and unsupported where the renderer cannot collect files', () => {
    for (const type of ['file-upload', 'signature']) {
      expect(FieldTypes.supported(type)).toBe(true);
      expect(FieldTypes.supported(type, false)).toBe(false);
    }

    expect(FieldTypes.supported('text', false)).toBe(true);
    expect(FieldTypes.supported('video')).toBe(false);
  });

  it('a definition lists them as unsupported only when files cannot be collected', () => {
    expect(form.unsupportedTypes()).toEqual([]);
    expect(form.unsupportedTypes(false)).toEqual(['file-upload', 'signature']);
  });
});
