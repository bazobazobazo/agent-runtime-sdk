import { describe, expect, it } from 'vitest';
import { createDefaultRuntimeRegistry, FetchHttpTransport, NodeMemorySecretStore, WsWebSocketFactory } from './index.js';
import { MemoryStateStore } from '@banzae/agent-runtime-core';

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
    await expect(http.request({ url: 'https://user:password@runtime.example.test', method: 'GET' })).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
    await expect(http.request({ url: 'https://runtime.example.test/?access_token=secret', method: 'GET' })).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
    const webSockets = new WsWebSocketFactory();
    await expect(webSockets.connect({ url: 'ftp://runtime.example.test' })).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
    await expect(webSockets.connect({ url: 'wss://runtime.example.test/?device_token=secret' })).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
  });
});
