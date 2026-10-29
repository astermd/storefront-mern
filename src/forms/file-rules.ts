import { Field } from './field';

/**
 * Ported from storefront-lamp/core/Forms/FileRules.php. What one file-upload question will take:
 * how many files, how large, and of which kinds.
 *
 * Two sets of limits meet here and the stricter always wins. The form author sets `maxFiles`,
 * `allowMultipleFiles`, `maxFileSizeMb` and, optionally, `fileTypes` (a comma-separated list of
 * extensions); the EMR's upload endpoints set the kinds of file they store and the largest file
 * they take. The browser checks the same rules before it sends a byte, so a refusal from here is a
 * request that went round the page.
 *
 * **The kind of a file is read from its extension**, not from the type the browser reports:
 * browsers report HEIC as an empty string and some report a `.mov` as `video/quicktime` and others
 * not at all. The extension maps to one MIME type, and that is the type the EMR is told.
 *
 * **Which endpoint a file takes**: the single-request endpoint refuses every video however small,
 * and the multipart one takes documents and images as well as video, so a video or anything over
 * `SINGLE_REQUEST_MAX_BYTES` goes in parts.
 */
export class FileRules {
  /**
   * The most one request to the EMR may carry. Its cap is 10 MiB measured on the whole multipart
   * envelope, boundaries and headers included, so a file of exactly 10 MiB is refused; 64 KiB is
   * left for the envelope. Also the size of every part of a multipart upload.
   */
  static readonly SINGLE_REQUEST_MAX_BYTES = 10 * 1024 * 1024 - 64 * 1024;

  /** The smallest part the multipart flow accepts, except the last one. */
  static readonly MIN_PART_BYTES = 5 * 1024 * 1024;

  /** The EMR's cap on one file, checked when a multipart upload starts. */
  static readonly MAX_FILE_BYTES = 200 * 1024 * 1024;

  /** What a question that states no size of its own takes, as the hosted form does. */
  private static readonly DEFAULT_MAX_MB = 10;

  /**
   * Every extension the EMR stores, and the MIME type it is sent as.
   *
   * HEIC and HEIF are here although the EMR does not take them yet: phones take photos in them,
   * and a refusal from the EMR names the type, which is a better answer for a patient than a
   * picker that will not open the file.
   */
  static readonly EXTENSIONS: Readonly<Record<string, string>> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    heic: 'image/heic',
    heif: 'image/heif',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    txt: 'text/plain',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
  };

  /**
   * @param maxFiles null when the question takes any number
   * @param extensions lower-case, without the dot
   */
  private constructor(
    public readonly maxFiles: number | null,
    public readonly maxBytes: number,
    public readonly extensions: string[],
    public readonly dragDrop: boolean,
  ) {}

  /**
   * Read the way the hosted form reads them: several files only when `allowMultipleFiles` says so,
   * or, on a form older than that flag, when `maxFiles` is above one; and then as many as
   * `maxFiles` allows, or any number when it is not set above one.
   */
  static for(field: Field): FileRules {
    const properties = field.properties;
    const maxFiles = FileRules.isNumeric(properties.maxFiles) ? Math.trunc(Number(properties.maxFiles)) : null;
    const multiple = typeof properties.allowMultipleFiles === 'boolean' ? properties.allowMultipleFiles : (maxFiles ?? 1) > 1;

    const megabytes =
      FileRules.isNumeric(properties.maxFileSizeMb) && Number(properties.maxFileSizeMb) > 0
        ? Number(properties.maxFileSizeMb)
        : FileRules.DEFAULT_MAX_MB;

    return new FileRules(
      multiple ? (maxFiles !== null && maxFiles > 1 ? maxFiles : null) : 1,
      Math.min(FileRules.MAX_FILE_BYTES, Math.floor(megabytes * 1024 * 1024)),
      FileRules.extensionsFrom(properties.fileTypes),
      properties.dragDrop !== false,
    );
  }

  /** The MIME type a file of this name is sent as, or null when the question does not take it. */
  mimeTypeFor(fileName: string): string | null {
    const extension = FileRules.extensionOf(fileName);
    return this.extensions.includes(extension) ? FileRules.EXTENSIONS[extension] : null;
  }

  /** Why this file cannot be attached, in words for the patient, or null when it can. */
  refusal(fileName: string, bytes: number): string | null {
    if (this.mimeTypeFor(fileName) === null) {
      return `${FileRules.displayName(fileName)} is not a file type this question accepts.`;
    }

    if (bytes <= 0) {
      return `${FileRules.displayName(fileName)} is empty.`;
    }

    if (bytes > this.maxBytes) {
      return `${FileRules.displayName(fileName)} is larger than ${FileRules.megabytes(this.maxBytes)}.`;
    }

    return null;
  }

  /** Whether a file goes up in parts rather than in one request. */
  static needsParts(mimeType: string, bytes: number): boolean {
    return mimeType.startsWith('video/') || bytes > FileRules.SINGLE_REQUEST_MAX_BYTES;
  }

  /**
   * The most one request to this server can carry, which bounds every request the page sends.
   * PHP's `upload_max_filesize` / `post_max_size` have no equivalent here: the upload routes read
   * bodies through multer, whose per-file limit is set to exactly this, so it is the EMR's own cap.
   */
  static requestBytes(): number {
    return FileRules.SINGLE_REQUEST_MAX_BYTES;
  }

  /** The `accept` attribute for the file picker. */
  accept(): string {
    return this.extensions.map((extension) => `.${extension}`).join(',');
  }

  static megabytes(bytes: number): string {
    const value = bytes / (1024 * 1024);
    return `${Number.isInteger(value) ? String(value) : value.toFixed(1)} MB`;
  }

  /**
   * The author's list where there is one, kept to what the EMR stores: an extension it refuses
   * would let a patient wait out an upload only to be told no at the end.
   */
  private static extensionsFrom(authored: unknown): string[] {
    const known = Object.keys(FileRules.EXTENSIONS);
    if (typeof authored !== 'string' || authored.trim() === '') return known;

    const chosen: string[] = [];
    for (const entry of authored.toLowerCase().split(',')) {
      const extension = entry.trim().replace(/^\.+/, '');
      if (known.includes(extension) && !chosen.includes(extension)) chosen.push(extension);
    }

    return chosen.length === 0 ? known : chosen;
  }

  private static isNumeric(value: unknown): boolean {
    if (typeof value === 'number') return Number.isFinite(value);
    return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));
  }

  private static extensionOf(fileName: string): string {
    const dot = fileName.lastIndexOf('.');
    return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();
  }

  private static displayName(fileName: string): string {
    const name = fileName.trim();
    return name === '' ? 'This file' : name;
  }
}
