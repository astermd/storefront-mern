import { FileReference } from '../../src/forms/file-reference';
import { IntakeUploads } from '../../src/forms/intake-uploads';
import { UploadOutcome } from '../../src/forms/upload-outcome';

/**
 * In-memory `IntakeUploads`: answers the way the EMR does, filing every file under the session it
 * was sent for, and records each call so a test can assert what reached the EMR — and, as often,
 * that nothing did. Ported from storefront-lamp/tests/Support/FakeIntakeUploads.php.
 *
 * `refuse` makes every call answer as the EMR answers a type it does not store.
 */
export class FakeIntakeUploads implements IntakeUploads {
  calls: Array<Record<string, unknown>> = [];
  refuse = false;
  private readonly sessions = new Map<string, string>();

  async upload(session: string, buffer: Buffer, fileName: string, mimeType: string): Promise<UploadOutcome> {
    this.calls.push({ call: 'upload', session, name: fileName, mime_type: mimeType, bytes: buffer.length });
    return this.refuse ? UploadOutcome.refused() : UploadOutcome.stored(FakeIntakeUploads.stored(session, fileName, mimeType));
  }

  async start(session: string, fileName: string, mimeType: string, bytes: number): Promise<UploadOutcome> {
    this.calls.push({ call: 'start', session, name: fileName, mime_type: mimeType, bytes });
    if (this.refuse) return UploadOutcome.refused();

    const uploadId = `a1b2c3d4-0000-4000-8000-${String(this.sessions.size + 1).padStart(12, '0')}`;
    this.sessions.set(uploadId, session);
    return UploadOutcome.started(uploadId);
  }

  async part(uploadId: string, partNumber: number, buffer: Buffer): Promise<UploadOutcome> {
    this.calls.push({ call: 'part', upload_id: uploadId, part_number: partNumber, bytes: buffer.length });
    return UploadOutcome.partStored(partNumber, `"etag-${partNumber}"`);
  }

  async finish(uploadId: string, parts: Array<{ part_number: number; etag: string }>): Promise<UploadOutcome> {
    this.calls.push({ call: 'finish', upload_id: uploadId, parts });
    return UploadOutcome.stored(FakeIntakeUploads.stored(this.sessions.get(uploadId) ?? 'unknown', 'clip.mp4', 'video/mp4'));
  }

  async abort(uploadId: string): Promise<void> {
    this.calls.push({ call: 'abort', upload_id: uploadId });
  }

  callNames(): string[] {
    return this.calls.map((call) => String(call.call));
  }

  private static stored(session: string, fileName: string, mimeType: string): FileReference {
    const dot = fileName.lastIndexOf('.');
    const name = (dot === -1 ? fileName : fileName.slice(0, dot)) + '-3f9a1c62-2b41-4f0e-91a7-6c1d0e5b8a44' + (dot === -1 ? '' : fileName.slice(dot));

    const reference = FileReference.fromArray({ path: `acct1/org1/intake_submissions/${session}/${name}`, name, mime_type: mimeType });
    if (reference === null) throw new Error('the fake built a reference FileReference refuses');
    return reference;
  }
}
