import { FileReference } from '../../src/forms/file-reference';

/** Ported from storefront-lamp/tests/Forms/FileReferenceTest.php. */
const SESSION = '550e8400-e29b-41d4-a716-446655440000';

describe('FileReference', () => {
  it("a reference filed under the visitor's session is theirs", () => {
    const reference = FileReference.fromPosted(
      JSON.stringify({
        path: `64b2f0c7e3a1d2b3c4e5f6a8/64b2f0c7e3a1d2b3c4e5f6a9/intake_submissions/${SESSION}/id-front-3f9a1c62.jpg`,
        name: 'id-front-3f9a1c62.jpg',
        mime_type: 'image/jpeg',
      }),
    );

    expect(reference).not.toBeNull();
    expect(reference?.belongsTo(SESSION)).toBe(true);
    expect(reference?.belongsTo(SESSION.toUpperCase())).toBe(true);
    expect(reference?.belongsTo('9e8d7c6b-5a49-4382-9170-6f5e4d3c2b1a')).toBe(false);
  });

  it('a path the EMR would never have answered is not a reference', () => {
    for (const path of [
      `../intake_submissions/${SESSION}/x.pdf`,
      `a/b/intake_submissions/${SESSION}/../../other/x.pdf`,
      `a/b/patient_notes/${SESSION}/x.pdf`,
      'a/b/intake_submissions/not-a-uuid/x.pdf',
    ]) {
      expect(FileReference.fromArray({ path, name: 'x.pdf', mime_type: 'application/pdf' })).toBeNull();
    }

    expect(FileReference.fromPosted('not json')).toBeNull();
    expect(FileReference.fromPosted('')).toBeNull();
  });
});
