import { GeneratedConfigWriter } from '../../src/catalog/generated-config-writer';

describe('GeneratedConfigWriter.mergeOntoExisting', () => {
  it('replaces wholesale when there is no existing payload', () => {
    const next = { channel: { id: 'c1', name: 'Channel' }, payment_processor: { provider_category: 'vrio', name: 'Vrio', config: {} } };
    expect(GeneratedConfigWriter.mergeOntoExisting({}, next)).toEqual(next);
  });

  it('replaces wholesale when the channel id changed — a different deployment target', () => {
    const existing = { channel: { id: 'old-channel' }, custom: { hand: 'added' } };
    const next = { channel: { id: 'new-channel' }, payment_processor: { provider_category: 'checkout_champ' } };

    expect(GeneratedConfigWriter.mergeOntoExisting(existing, next)).toEqual(next);
  });

  it('keeps a hand-added key when re-syncing the same channel', () => {
    const existing = { channel: { id: 'c1' }, payment_processor: { provider_category: 'vrio', config: {} }, operator_note: 'do not touch' };
    const next = { channel: { id: 'c1', name: 'Renamed' }, payment_processor: { provider_category: 'checkout_champ', config: { key: 'abc' } } };

    const merged = GeneratedConfigWriter.mergeOntoExisting(existing, next);

    expect(merged.operator_note).toBe('do not touch');
    expect(merged.channel).toEqual({ id: 'c1', name: 'Renamed' });
  });

  it('always replaces payment_processor wholesale, even on a same-channel merge', () => {
    const existing = { channel: { id: 'c1' }, payment_processor: { provider_category: 'vrio', config: { old_key: 'stale-credential' } } };
    const next = { channel: { id: 'c1' }, payment_processor: { provider_category: 'checkout_champ', config: { new_key: 'fresh-credential' } } };

    const merged = GeneratedConfigWriter.mergeOntoExisting(existing, next);

    expect(merged.payment_processor).toEqual({ provider_category: 'checkout_champ', config: { new_key: 'fresh-credential' } });
  });

  it('recurses into nested objects so a hand-added nested key survives too', () => {
    const existing = { channel: { id: 'c1' }, settings: { theme: { color: 'blue' }, other: 'kept' } };
    const next = { channel: { id: 'c1' }, settings: { theme: { color: 'red' } } };

    const merged = GeneratedConfigWriter.mergeOntoExisting(existing, next);

    expect(merged.settings).toEqual({ theme: { color: 'red' }, other: 'kept' });
  });

  it('treats a missing channel id on both sides as identical (no accidental full-replace)', () => {
    const existing = { channel: {}, kept: 'value' };
    const next = { channel: {}, payment_processor: {} };

    const merged = GeneratedConfigWriter.mergeOntoExisting(existing, next);

    expect(merged.kept).toBe('value');
  });
});

describe('GeneratedConfigWriter.channelPayload', () => {
  it('extracts channel id/name and the payment processor block from a raw channel-detail payload', () => {
    const payload = GeneratedConfigWriter.channelPayload({
      _id: 'chan1',
      name: 'My Channel',
      payment_processor: { provider_category: 'vrio', name: 'Vrio', config: { key: 'abc' } },
    });

    expect(payload).toEqual({
      channel: { id: 'chan1', name: 'My Channel' },
      payment_processor: { provider_category: 'vrio', name: 'Vrio', config: { key: 'abc' } },
    });
  });

  it('defaults every field to null/empty when the payload has no payment_processor at all', () => {
    const payload = GeneratedConfigWriter.channelPayload({ _id: 'chan1', name: 'My Channel' });

    expect(payload).toEqual({
      channel: { id: 'chan1', name: 'My Channel' },
      payment_processor: { provider_category: null, name: null, config: {} },
    });
  });
});
