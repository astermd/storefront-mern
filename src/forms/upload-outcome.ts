import { FileReference } from './file-reference';

/**
 * Ported from storefront-lamp/core/Forms/UploadOutcome.php. What one call to the EMR's upload
 * endpoints came back with.
 *
 * A refusal and a failure are kept apart because they ask different things of the patient. A
 * refusal is the EMR saying no to this file — its type, its size — and trying again will not help,
 * so the page says to choose another. A failure is the call not completing, and trying again might.
 */
export class UploadOutcome {
  private constructor(
    public readonly ok: boolean,
    public readonly file: FileReference | null = null,
    public readonly uploadId: string | null = null,
    public readonly part: { part_number: number; etag: string } | null = null,
    public readonly refused: boolean = false,
  ) {}

  static stored(file: FileReference): UploadOutcome {
    return new UploadOutcome(true, file);
  }

  static started(uploadId: string): UploadOutcome {
    return new UploadOutcome(true, null, uploadId);
  }

  static partStored(partNumber: number, etag: string): UploadOutcome {
    return new UploadOutcome(true, null, null, { part_number: partNumber, etag });
  }

  static refused(): UploadOutcome {
    return new UploadOutcome(false, null, null, null, true);
  }

  static failed(): UploadOutcome {
    return new UploadOutcome(false);
  }
}
