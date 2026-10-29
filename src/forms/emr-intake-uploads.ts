import { ApiError, FileUpload } from '@astermd-hq/sdk';
import { EmrClientFactory } from '../emr/client-factory';
import { OperatorLog } from '../support/operator-log';
import { FileReference } from './file-reference';
import { IntakeUploads } from './intake-uploads';
import { UploadOutcome } from './upload-outcome';

/**
 * Ported from storefront-lamp/core/Forms/EmrIntakeUploads.php. {@link IntakeUploads} over the SDK's
 * `intakeSubmissions()` upload calls.
 *
 * **A 400 is a refusal of the file**, and every other failure is a failure. The endpoints answer
 * 400 for a type they do not store, a file over their cap and a part they cannot assemble, which
 * are all things the patient fixes by choosing another file.
 *
 * What a failure writes to the log follows `EmrIntakeGateway`: the exception class and status,
 * never its message, since a provider message may echo what it was sent.
 */
export class EmrIntakeUploads implements IntakeUploads {
  constructor(
    private readonly clients: EmrClientFactory,
    private readonly log: OperatorLog,
  ) {}

  async upload(session: string, buffer: Buffer, fileName: string, mimeType: string): Promise<UploadOutcome> {
    let data: unknown;
    try {
      const file = FileUpload.fromContents(buffer, fileName, { mimeType });
      data = (await this.clients.create().intakeSubmissions().uploadFile({ sessionId: session, file })).data();
    } catch (e) {
      return this.unsuccessful('upload', e);
    }

    return this.stored('upload', data);
  }

  async start(session: string, fileName: string, mimeType: string, bytes: number): Promise<UploadOutcome> {
    let data: unknown;
    try {
      data = (
        await this.clients.create().intakeSubmissions().initiateMultipartUpload({ sessionId: session, fileName, mimeType, fileSize: bytes })
      ).data();
    } catch (e) {
      return this.unsuccessful('start', e);
    }

    const uploadId = EmrIntakeUploads.field(data, 'upload_id');

    return typeof uploadId === 'string' && uploadId !== '' ? UploadOutcome.started(uploadId) : this.malformed('start');
  }

  async part(uploadId: string, partNumber: number, buffer: Buffer, fileName: string, mimeType: string): Promise<UploadOutcome> {
    let data: unknown;
    try {
      const part = FileUpload.fromContents(buffer, fileName, { mimeType });
      data = (await this.clients.create().intakeSubmissions().uploadMultipartPart({ uploadId, partNumber, part })).data();
    } catch (e) {
      return this.unsuccessful('part', e);
    }

    const etag = EmrIntakeUploads.field(data, 'etag');
    const number = Number(EmrIntakeUploads.field(data, 'part_number') ?? partNumber);

    // The ETag goes back to `finish` exactly as it came, quotes and all.
    return typeof etag === 'string' && etag !== '' ? UploadOutcome.partStored(Number.isFinite(number) ? number : partNumber, etag) : this.malformed('part');
  }

  async finish(uploadId: string, parts: Array<{ part_number: number; etag: string }>): Promise<UploadOutcome> {
    const ordered = [...parts].sort((a, b) => a.part_number - b.part_number);

    let data: unknown;
    try {
      data = (await this.clients.create().intakeSubmissions().finishMultipartUpload({ uploadId, parts: ordered })).data();
    } catch (e) {
      return this.unsuccessful('finish', e);
    }

    return this.stored('finish', data);
  }

  async abort(uploadId: string): Promise<void> {
    try {
      await this.clients.create().intakeSubmissions().abortMultipartUpload(uploadId);
    } catch (e) {
      this.unsuccessful('abort', e);
    }
  }

  private stored(call: string, data: unknown): UploadOutcome {
    const file = FileReference.fromArray(data);
    return file === null ? this.malformed(call) : UploadOutcome.stored(file);
  }

  private unsuccessful(call: string, e: unknown): UploadOutcome {
    const status = e instanceof ApiError ? e.statusCode() : null;

    this.log.warning('intake.upload_failed', { call, exception: (e as Error).constructor.name, status });

    return status === 400 ? UploadOutcome.refused() : UploadOutcome.failed();
  }

  private malformed(call: string): UploadOutcome {
    this.log.warning('intake.upload_unreadable', { call });
    return UploadOutcome.failed();
  }

  private static field(data: unknown, key: string): unknown {
    return data !== null && typeof data === 'object' ? (data as Record<string, unknown>)[key] : null;
  }
}
