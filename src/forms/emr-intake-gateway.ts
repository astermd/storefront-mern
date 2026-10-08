import { Injectable } from '@nestjs/common';
import { ApiError, Event, FileUpload } from '@astermd-hq/sdk';
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

  /**
   * No PHP equivalent — see `field-types.ts`'s doc comment on `file-upload`. The response's
   * reference key isn't pinned down in the SDK's own types (`data()` is a generic
   * `Record<string, unknown>`), so several plausible names are tried in order rather than
   * assuming one — an upload that stored the file but returned an unrecognised shape should log
   * loudly, not silently drop the reference.
   */
  async uploadFile(session: string, fileName: string, mimeType: string, buffer: Buffer): Promise<string | null> {
    try {
      const file = FileUpload.fromContents(buffer, fileName, { mimeType });
      const response = await this.clients.create().intakeSubmissions().uploadFile({ sessionId: session, file });
      const data = response.data() as Record<string, unknown>;

      // `path` is what the live sales service actually returns (confirmed against the real
      // dev-sandbox, alongside `name`/`mime_type` echoing the upload back) — kept alongside a few
      // other plausible names since the SDK's own types leave this generic (`data()` is a bare
      // `Record<string, unknown>`), and a future endpoint variant may answer differently.
      const reference = data.path ?? data.reference ?? data.file_reference ?? data.url ?? data.id ?? null;
      if (typeof reference === 'string' && reference !== '') {
        return reference;
      }

      this.log.warning('intake.upload_reference_unrecognised', { session, keys: Object.keys(data).join(',') });
      return null;
    } catch (e) {
      this.log.warning('intake.upload_failed', {
        session,
        file_name: fileName,
        exception: (e as Error).constructor.name,
        status: e instanceof ApiError ? e.statusCode() : null,
      });
      return null;
    }
  }
}
