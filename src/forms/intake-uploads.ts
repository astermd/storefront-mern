import { UploadOutcome } from './upload-outcome';

/**
 * The EMR's file storage for intake
 * answers: a file goes up on its own, before the submission that names it, and comes back as a
 * `FileReference` the answer carries.
 *
 * Two routes, because the EMR has two. A small document or image is one request; a video, or
 * anything larger than one request may carry, is started, sent in numbered parts and finished, and
 * a started upload that will not be finished is aborted so the EMR drops what it holds.
 * `FileRules` decides which route a file takes.
 *
 * Bytes arrive as buffers (read from multer's memory storage, never a temp file on disk). The bytes are PHI. An implementation logs that a call failed and how, never what
 * was in it.
 */
export interface IntakeUploads {
  upload(session: string, buffer: Buffer, fileName: string, mimeType: string): Promise<UploadOutcome>;

  start(session: string, fileName: string, mimeType: string, bytes: number): Promise<UploadOutcome>;

  part(uploadId: string, partNumber: number, buffer: Buffer, fileName: string, mimeType: string): Promise<UploadOutcome>;

  finish(uploadId: string, parts: Array<{ part_number: number; etag: string }>): Promise<UploadOutcome>;

  /** Best effort: the upload is already being given up on, and nothing waits on this. */
  abort(uploadId: string): Promise<void>;
}
