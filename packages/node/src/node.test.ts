import { describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
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

  it('bounds graceful close and force-terminates a half-open WebSocket', async () => {
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test WebSocket server did not bind a TCP port');
    let peer: WebSocket | undefined;
    const accepted = new Promise<void>((resolve) => {
      server.once('connection', (socket) => {
        peer = socket;
        (socket as unknown as { _socket: { pause(): void } })._socket.pause();
        resolve();
      });
    });
    const connection = await new WsWebSocketFactory().connect({ url: `ws://127.0.0.1:${address.port}` });
    await accepted;
    const startedAt = Date.now();

    await connection.close(1000, 'test close');

    expect(Date.now() - startedAt).toBeLessThan(1_500);
    (peer as unknown as { _socket: { resume(): void } })._socket.resume();
    peer?.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
