import { Event } from '@astermd-hq/sdk';
import { EncodedAnswer } from './answer-encoder';

/**
 * Ported from storefront-lamp/core/Forms/IntakeGateway.php. The storefront's view of the EMR's
 * intake-submission resource.
 */
export interface IntakeGateway {
  /**
   * @param data the encoded answer list (`AnswerEncoder.encode()`'s output)
   * @param progress optional `{ page, total }` position within the form
   */
  record(
    session: string,
    event: Event,
    teleformId: string,
    data: EncodedAnswer[],
    progress: { page: number; total: number } | null,
  ): Promise<boolean>;

  /**
   * Stores one file for a `file-upload` answer, before the answer that names it is recorded.
   * No PHP equivalent — see `field-types.ts`'s doc comment on `file-upload`.
   *
   * @returns The stored file's reference, to place as that field's answer value on the next
   *   `record()` call, or `null` if the upload failed.
   */
  uploadFile(session: string, fileName: string, mimeType: string, buffer: Buffer): Promise<string | null>;
}
