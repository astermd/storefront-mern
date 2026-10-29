import { EmrIntakeUploads } from '../../src/forms/emr-intake-uploads';
import { NullIntakeUploads } from '../../src/forms/null-intake-uploads';
import { apiError, capturedLog, fakeClients, response } from '../support/fake-emr-client';

/** Ported from storefront-lamp/tests/Forms/EmrIntakeUploadsTest.php. */
const SESSION = '550e8400-e29b-41d4-a716-446655440000';
const STORED = { path: `acct/org/intake_submissions/${SESSION}/id-3f9a.jpg`, name: 'id-3f9a.jpg', mime_type: 'image/jpeg' };

function uploads(intakeSubmissions: Record<string, jest.Mock>) {
  const captured = capturedLog();
  return { uploads: new EmrIntakeUploads(fakeClients({ intakeSubmissions }), captured.log), captured };
}

describe('EmrIntakeUploads', () => {
  it('a stored file comes back as the reference the answer carries', async () => {
    const uploadFile = jest.fn().mockResolvedValue(response(STORED));
    const { uploads: gateway } = uploads({ uploadFile });

    const outcome = await gateway.upload(SESSION, Buffer.from('bytes'), 'id.jpg', 'image/jpeg');

    expect(outcome.ok).toBe(true);
    expect(outcome.file?.toArray()).toEqual(STORED);
    expect(uploadFile.mock.calls[0][0].sessionId).toBe(SESSION);
    expect(uploadFile.mock.calls[0][0].file.mimeType()).toBe('image/jpeg');
  });

  it('a type the EMR does not store is a refusal, and its message stays out of the log', async () => {
    const { uploads: gateway, captured } = uploads({ uploadFile: jest.fn().mockRejectedValue(apiError(400, 'Cannot store ada-lovelace-passport.exe')) });

    const outcome = await gateway.upload(SESSION, Buffer.from('x'), 'a.pdf', 'application/pdf');

    expect(outcome.refused).toBe(true);
    expect(outcome.ok).toBe(false);
    expect(JSON.stringify(captured.lines)).not.toContain('ada-lovelace');
    expect(captured.lines[0]).toMatchObject({ event: 'intake.upload_failed', context: { call: 'upload', status: 400 } });
  });

  it('an outage is a failure to retry rather than a refusal', async () => {
    const { uploads: gateway } = uploads({ uploadFile: jest.fn().mockRejectedValue(apiError(503, 'down')) });

    const outcome = await gateway.upload(SESSION, Buffer.from('x'), 'a.pdf', 'application/pdf');

    expect(outcome.ok).toBe(false);
    expect(outcome.refused).toBe(false);
  });

  it('an answer that is not a reference is not taken for one', async () => {
    const { uploads: gateway, captured } = uploads({
      uploadFile: jest.fn().mockResolvedValue(response({ path: `acct/org/intake_submissions/${SESSION}/../other.pdf`, name: 'x', mime_type: 'a/b' })),
    });

    const outcome = await gateway.upload(SESSION, Buffer.from('x'), 'a.pdf', 'application/pdf');

    expect(outcome.ok).toBe(false);
    expect(captured.lines[0].event).toBe('intake.upload_unreadable');
  });

  it('a multipart upload starts, sends a part and finishes with the parts in order', async () => {
    const initiateMultipartUpload = jest.fn().mockResolvedValue(response({ upload_id: 'up-1' }));
    const uploadMultipartPart = jest.fn().mockImplementation(async ({ partNumber }) => response({ part_number: partNumber, etag: `"etag-${partNumber}"` }));
    const finishMultipartUpload = jest.fn().mockResolvedValue(response({ ...STORED, name: 'clip-3f9a.mp4', mime_type: 'video/mp4' }));
    const { uploads: gateway } = uploads({ initiateMultipartUpload, uploadMultipartPart, finishMultipartUpload });

    const started = await gateway.start(SESSION, 'clip.mp4', 'video/mp4', 12_000_000);
    const part = await gateway.part('up-1', 2, Buffer.from('p'), 'clip.mp4', 'video/mp4');
    const finished = await gateway.finish('up-1', [
      { part_number: 2, etag: '"etag-2"' },
      { part_number: 1, etag: '"etag-1"' },
    ]);

    expect(started.uploadId).toBe('up-1');
    expect(initiateMultipartUpload.mock.calls[0][0]).toMatchObject({ sessionId: SESSION, fileName: 'clip.mp4', mimeType: 'video/mp4', fileSize: 12_000_000 });
    expect(part.part).toEqual({ part_number: 2, etag: '"etag-2"' });
    expect(finishMultipartUpload.mock.calls[0][0].parts.map((p: { part_number: number }) => p.part_number)).toEqual([1, 2]);
    expect(finished.file?.mimeType).toBe('video/mp4');
  });

  it('aborting never throws', async () => {
    const { uploads: gateway } = uploads({ abortMultipartUpload: jest.fn().mockRejectedValue(apiError(500, 'x')) });

    await expect(gateway.abort('up-1')).resolves.toBeUndefined();
  });
});

describe('NullIntakeUploads', () => {
  it('fails every call, unlike the null intake gateway, so no patient is told a file was attached', async () => {
    const gateway = new NullIntakeUploads();

    expect((await gateway.upload()).ok).toBe(false);
    expect((await gateway.start()).ok).toBe(false);
    expect((await gateway.part()).ok).toBe(false);
    expect((await gateway.finish()).ok).toBe(false);
    await expect(gateway.abort()).resolves.toBeUndefined();
  });
});
