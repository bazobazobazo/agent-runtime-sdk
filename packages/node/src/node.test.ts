import { describe, expect, it } from 'vitest';
import { createDefaultRuntimeRegistry, EnvironmentRuntimeCredentialProvider, FetchHttpTransport, NodeMemorySecretStore, WsWebSocketFactory } from './index.js';
import { MemoryStateStore } from '@banzae/agent-runtime-core/testing';

describe('node facade', () => {
  it('registers OpenClaw and Hermes only', () => {
    const registry = createDefaultRuntimeRegistry({
      stateStore: new MemoryStateStore(),
      secretStore: new NodeMemorySecretStore(),
    });
    expect(registry.list().map((factory) => factory.adapterId).sort()).toEqual(['hermes', 'openclaw']);
  });

  it('rejects unsafe transport URLs before network activity', async () => {
    const http = new FetchHttpTransport();
    await expect(http.request({ url: 'https://user:password@runtime.example.test', method: 'GET' })).rejects.toMatchObject({ code: 'NETWORK_POLICY_REJECTED' });
    await expect(http.request({ url: 'https://runtime.example.test/?access_token=secret', method: 'GET' })).rejects.toMatchObject({ code: 'NETWORK_POLICY_REJECTED' });
    const webSockets = new WsWebSocketFactory();
    await expect(webSockets.connect({ url: 'ftp://runtime.example.test' })).rejects.toMatchObject({ code: 'NETWORK_POLICY_REJECTED' });
    await expect(webSockets.connect({ url: 'wss://runtime.example.test/?device_token=secret' })).rejects.toMatchObject({ code: 'NETWORK_POLICY_REJECTED' });
  });

  it('resolves only environment-backed credential references', async () => {
    const provider = new EnvironmentRuntimeCredentialProvider({ environment: { SDK_TOKEN: 'test-only-token' } });
    await expect(provider.resolve('env:SDK_TOKEN')).resolves.toEqual({ kind: 'bearer', token: 'test-only-token' });
    await expect(provider.resolve('literal-token')).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
    await expect(provider.resolve('env:MISSING')).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
  });
});
