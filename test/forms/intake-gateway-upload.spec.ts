import { Event } from '@astermd-hq/sdk';
import { IntakeGateway } from '../../src/forms/intake-gateway';
import { NullIntakeGateway } from '../../src/forms/null-intake-gateway';
import { RecordingIntakeGateway } from '../../src/forms/recording-intake-gateway';

/**
 * `uploadFile()` has no PHP equivalent — see `src/forms/field-types.ts`'s doc comment on
 * `file-upload` for why this port builds it for real. `EmrIntakeGateway.uploadFile()` itself is
 * proven against the live AsterMD dev-sandbox rather than unit-tested here (see STATUS.md) — a
 * real upload's response shape isn't something a mock could stand in for faithfully.
 */
describe('NullIntakeGateway.uploadFile', () => {
  it('returns null — no file was actually stored, unlike record()\'s look-like-success rule', async () => {
    const gateway: IntakeGateway = new NullIntakeGateway();
    expect(await gateway.uploadFile('session-1', 'id.jpg', 'image/jpeg', Buffer.from('x'))).toBeNull();
  });
});

describe('RecordingIntakeGateway.uploadFile', () => {
  it('delegates straight to the inner gateway, with no local audit write for the upload itself', async () => {
    const inner: IntakeGateway = {
      record: jest.fn().mockResolvedValue(true),
      uploadFile: jest.fn().mockResolvedValue('stored/path/id.jpg'),
    };
    const events = { append: jest.fn() };
    const gateway = new RecordingIntakeGateway(inner, events as never);

    const reference = await gateway.uploadFile('session-1', 'id.jpg', 'image/jpeg', Buffer.from('x'));

    expect(reference).toBe('stored/path/id.jpg');
    expect(inner.uploadFile).toHaveBeenCalledWith('session-1', 'id.jpg', 'image/jpeg', Buffer.from('x'));
    expect(events.append).not.toHaveBeenCalled();
  });

  it('still writes the local audit trail for record(), unaffected by uploadFile existing alongside it', async () => {
    const inner: IntakeGateway = {
      record: jest.fn().mockResolvedValue(true),
      uploadFile: jest.fn().mockResolvedValue(null),
    };
    const events = { append: jest.fn() };
    const gateway = new RecordingIntakeGateway(inner, events as never);

    await gateway.record('session-1', Event.IntakeInitiated, 'tf-1', [], null);

    expect(events.append).toHaveBeenCalledWith('session-1', `intake.${Event.IntakeInitiated}`, expect.objectContaining({ teleform_id: 'tf-1' }));
  });
});
