import { VrioCredentials } from '../../../src/payment/vrio/vrio-credentials';

describe('VrioCredentials.fromChannelConfig', () => {
  it('splits a full endpoint URL into host and base path', () => {
    const credentials = VrioCredentials.fromChannelConfig({ api_key: 'k1', api_endpoint: 'https://api.vrio.app/v1/', campaign_id: 147, connection_id: 3 });
    expect(credentials.host).toBe('api.vrio.app');
    expect(credentials.basePath).toBe('v1');
    expect(credentials.campaignId).toBe(147);
    expect(credentials.connectionId).toBe(3);
  });

  it('accepts a bare hostname with no scheme', () => {
    const credentials = VrioCredentials.fromChannelConfig({ api_key: 'k1', api_endpoint: 'api.vrio.app' });
    expect(credentials.host).toBe('api.vrio.app');
    expect(credentials.basePath).toBe('');
  });

  it('throws when api_key is missing or blank', () => {
    expect(() => VrioCredentials.fromChannelConfig({ api_endpoint: 'api.vrio.app' })).toThrow(/api_key/);
    expect(() => VrioCredentials.fromChannelConfig({ api_key: '  ', api_endpoint: 'api.vrio.app' })).toThrow(/api_key/);
  });

  it('throws when api_endpoint is missing or unusable', () => {
    expect(() => VrioCredentials.fromChannelConfig({ api_key: 'k1' })).toThrow(/api_endpoint/);
  });

  it('never exposes the api key through JSON.stringify or util.inspect', () => {
    const credentials = VrioCredentials.fromChannelConfig({ api_key: 'super-secret', api_endpoint: 'api.vrio.app' });
    expect(JSON.stringify(credentials)).not.toContain('super-secret');
    expect(credentials.apiKey()).toBe('super-secret');
  });
});
