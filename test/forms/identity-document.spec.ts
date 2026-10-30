import { AnswerSet } from '../../src/forms/answer-set';
import { Definition } from '../../src/forms/definition';
import { IntakeSession } from '../../src/forms/intake-session';

const SESSION = '550e8400-e29b-41d4-a716-446655440000';
const PATTERN = '\\b(id|identity|licen[cs]e|passport|document)\\b';

const file = (name: string) => ({ path: `a/b/intake_submissions/${SESSION}/${name}`, name, mime_type: 'image/jpeg' });

const form = Definition.fromArray({
  pages: [
    {
      pageId: 'p1',
      order: 0,
      fields: [
        { fieldId: 'labs', name: 'labs', type: 'file-upload', label: 'Lab results' },
        { fieldId: 'doc', name: 'file_upload_1', type: 'file-upload', label: 'Document upload' },
      ],
    },
  ],
});

/** `identityDocumentIn` is private; it only reads `this.config`, so a bare receiver exercises it. */
function documentIn(answers: Record<string, unknown>, verification: { documentFieldPattern?: string } = { documentFieldPattern: PATTERN }): string | null {
  const receiver = { config: { verification } };
  return (IntakeSession.prototype as unknown as { identityDocumentIn(d: Definition, a: AnswerSet): string | null }).identityDocumentIn.call(
    receiver,
    form,
    AnswerSet.fromArray(answers),
  );
}

describe('the ID document an intake collects', () => {
  it('is the file uploaded to the question whose label names a document', () => {
    expect(documentIn({ file_upload_1: [file('id.jpg')] })).toBe(`a/b/intake_submissions/${SESSION}/id.jpg`);
  });

  it('is not a file uploaded to some other question', () => {
    expect(documentIn({ labs: [file('labs.pdf')] })).toBeNull();
  });

  it('is nothing before a file is attached', () => {
    expect(documentIn({ file_upload_1: [] })).toBeNull();
  });

  it('is nothing when no pattern is configured or the pattern is not a regular expression', () => {
    expect(documentIn({ file_upload_1: [file('id.jpg')] }, {})).toBeNull();
    expect(documentIn({ file_upload_1: [file('id.jpg')] }, { documentFieldPattern: '(' })).toBeNull();
  });
});
