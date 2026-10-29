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
}
