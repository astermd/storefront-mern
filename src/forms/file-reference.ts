/**
 * Ported from storefront-lamp/core/Forms/FileReference.php. One uploaded file as the EMR named it:
 * the `{path, name, mime_type}` its upload endpoints answer, which is exactly what a file-upload
 * answer carries into the intake submission.
 *
 * **A reference is accepted only under the visitor's own session.** The EMR files every upload at
 * `{account}/{org}/intake_submissions/{session}/{name}`, and the answer comes back from the
 * browser, so without this check a visitor could attach another patient's stored file to their own
 * submission by posting its path. `belongsTo()` is what every posted reference is held to before
 * it is stored.
 */
const PATH_SHAPE = /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/intake_submissions\/([0-9A-Fa-f-]{36})\/[^/]+$/;

export interface StoredFile {
  path: string;
  name: string;
  mime_type: string;
}

export class FileReference {
  private constructor(
    public readonly path: string,
    public readonly name: string,
    public readonly mimeType: string,
  ) {}

  /** From the EMR's answer, or from an answer already stored. Null for anything else. */
  static fromArray(raw: unknown): FileReference | null {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;

    const { path, name, mime_type: mimeType } = raw as Record<string, unknown>;
    if (typeof path !== 'string' || typeof name !== 'string' || typeof mimeType !== 'string') return null;
    if (!PATH_SHAPE.test(path) || name.trim() === '') return null;

    return new FileReference(path, name, mimeType);
  }

  /** From the JSON a page posts for each attached file. */
  static fromPosted(posted: unknown): FileReference | null {
    if (posted !== null && typeof posted === 'object') return FileReference.fromArray(posted);
    if (typeof posted !== 'string' || posted === '' || posted.length > 2048) return null;

    try {
      return FileReference.fromArray(JSON.parse(posted));
    } catch {
      return null;
    }
  }

  belongsTo(session: string): boolean {
    const match = PATH_SHAPE.exec(this.path);
    return match !== null && match[1].toLowerCase() === session.toLowerCase();
  }

  toArray(): StoredFile {
    return { path: this.path, name: this.name, mime_type: this.mimeType };
  }
}
