import { Injectable } from '@nestjs/common';
import { ApiError, Event } from '@astermd-hq/sdk';
import { EmrClientFactory } from '../emr/client-factory';
import { OperatorLog } from '../support/operator-log';
import { EncodedAnswer } from './answer-encoder';
import { IntakeGateway } from './intake-gateway';

/** Ported from storefront-lamp/core/Forms/EmrIntakeGateway.php. {@link IntakeGateway} over the SDK's `intakeSubmissions()` resource. */
@Injectable()
export class EmrIntakeGateway implements IntakeGateway {
  constructor(
    private readonly clients: EmrClientFactory,
    private readonly log: OperatorLog,
  ) {}

  async record(
    session: string,
    event: Event,
    teleformId: string,
    data: EncodedAnswer[],
    progress: { page: number; total: number } | null,
  ): Promise<boolean> {
    const initiating = event === Event.PreQualifyingInitiated || event === Event.IntakeInitiated;

    try {
      const options = {
        session,
        event,
        teleformId,
        data: data as unknown as Record<string, unknown>[],
        progress: progress ?? undefined,
      };
      if (initiating) {
        await this.clients.create().intakeSubmissions().create(options);
      } else {
        await this.clients.create().intakeSubmissions().update(options);
      }
      return true;
    } catch (e) {
      this.log.warning('intake.submission_failed', {
        session,
        operation: initiating ? 'create' : 'update',
        event,
        teleform_id: teleformId,
        fields: data.length,
        exception: (e as Error).constructor.name,
        status: e instanceof ApiError ? e.statusCode() : null,
      });
      return false;
    }
  }
}
