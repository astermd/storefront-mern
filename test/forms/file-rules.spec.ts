import { Field } from '../../src/forms/field';
import { FileRules } from '../../src/forms/file-rules';

/**
 * Ported from storefront-lamp/tests/Forms/FileRulesTest.php. A file-upload question's limits, read
 * the way the hosted form reads them and held to what the EMR stores.
 */
function rules(properties: Record<string, unknown>): FileRules {
  return FileRules.for(Field.fromArray({ fieldId: 'f', name: 'f', type: 'file-upload', label: 'Files', properties }));
}

describe('FileRules', () => {
  it('a question that states nothing takes one file of any stored kind up to ten megabytes', () => {
    const r = rules({});

    expect(r.maxFiles).toBe(1);
    expect(r.maxBytes).toBe(10 * 1024 * 1024);
    expect(r.extensions).toEqual(Object.keys(FileRules.EXTENSIONS));
    expect(r.dragDrop).toBe(true);
  });

  it('several files are allowed only when the question says so', () => {
    expect(rules({ allowMultipleFiles: true, maxFiles: 3 }).maxFiles).toBe(3);
    expect(rules({ allowMultipleFiles: true }).maxFiles).toBeNull();
    expect(rules({ allowMultipleFiles: false, maxFiles: 3 }).maxFiles).toBe(1);
    expect(rules({ maxFiles: 3 }).maxFiles).toBe(3);
  });

  it("the author's size is held to the EMR's cap", () => {
    expect(rules({ maxFileSizeMb: 5 }).maxBytes).toBe(5 * 1024 * 1024);
    expect(rules({ maxFileSizeMb: 500 }).maxBytes).toBe(FileRules.MAX_FILE_BYTES);
  });

  it("the author's kinds are kept to those the EMR stores", () => {
    const r = rules({ fileTypes: 'pdf, .PNG, zip' });

    expect(r.extensions).toEqual(['pdf', 'png']);
    expect(r.accept()).toBe('.pdf,.png');
  });

  it('a file is judged by its extension, not by what the browser called it', () => {
    const r = rules({ maxFileSizeMb: 5 });

    expect(r.mimeTypeFor('IMG_0001.HEIC')).toBe('image/heic');
    expect(r.mimeTypeFor('clip.mov')).toBe('video/quicktime');
    expect(r.refusal('labs.pdf', 1000)).toBeNull();
    expect(r.refusal('setup.exe', 1000)).toBe('setup.exe is not a file type this question accepts.');
    expect(r.refusal('labs.pdf', 0)).toBe('labs.pdf is empty.');
    expect(r.refusal('scan.png', 5 * 1024 * 1024 + 1)).toBe('scan.png is larger than 5 MB.');
  });

  it('a video or anything over one request goes up in parts', () => {
    expect(FileRules.needsParts('video/mp4', 1000)).toBe(true);
    expect(FileRules.needsParts('application/pdf', FileRules.SINGLE_REQUEST_MAX_BYTES)).toBe(false);
    expect(FileRules.needsParts('application/pdf', FileRules.SINGLE_REQUEST_MAX_BYTES + 1)).toBe(true);
  });
});
