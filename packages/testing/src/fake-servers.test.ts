import { describe, expect, it } from 'vitest';
import { createTestDependencies } from '@banzae/agent-runtime-core/testing';
import { OpenClawAdapter } from '../../adapter-openclaw/src/index.js';
import { openClawV3Codec } from '../../adapter-openclaw/src/protocol/v3/codec.js';
import { openClawV4Codec } from '../../adapter-openclaw/src/protocol/v4/codec.js';
import { HermesAdapter } from '../../adapter-hermes/src/index.js';
import { FakeHermesServer } from './fake-hermes-server.js';
import { FakeOpenClawV3Server, FakeOpenClawV4Server } from './fake-openclaw-server.js';

describe('testing-only fake runtime controllers', () => {
  it('uses distinct v3 and v4 handshakes and wire event mappings', async () => {
    const v3 = new FakeOpenClawV3Server();
    const v4 = new FakeOpenClawV4Server();
    const adapter3 = new OpenClawAdapter(createTestDependencies({ webSockets: v3 }), { protocols: [openClawV3Codec()] });
    const adapter4 = new OpenClawAdapter(createTestDependencies({ webSockets: v4 }), { protocols: [openClawV4Codec()] });

    const [info3, info4] = await Promise.all([
      adapter3.connect(v3.createTarget().connection),
      adapter4.connect(v4.createTarget().connection),
    ]);

    expect(info3.descriptor).toMatchObject({ runtimeVersion: '2026.4.22', protocolName: 'openclaw-gateway-v3', protocolVersion: '3' });
    expect(info4.descriptor).toMatchObject({ runtimeVersion: '2026.6.11', protocolName: 'openclaw-gateway-v4', protocolVersion: '4' });
    expect(v3.receivedProtocolVersions).toEqual([3]);
    expect(v4.receivedProtocolVersions).toEqual([4]);
    await Promise.all([adapter3.close(), adapter4.close()]);
    expect(v3.resourceSnapshot().openConnections).toBe(0);
    expect(v4.resourceSnapshot().openConnections).toBe(0);
  });

  it('routes reverse-order concurrent OpenClaw responses on one socket', async () => {
    const server = new FakeOpenClawV4Server({ reverseConcurrentResponses: true });
    const adapter = new OpenClawAdapter(createTestDependencies({ webSockets: server }), { protocols: [openClawV4Codec()] });
    await adapter.connect(server.createTarget().connection);
    const [firstSession, secondSession] = await Promise.all([
      adapter.ensureSession({ applicationSessionId: 'session-one' }),
      adapter.ensureSession({ applicationSessionId: 'session-two' }),
    ]);
    const [first, second] = await Promise.all([
      adapter.startRun({ applicationRunId: 'application-one', idempotencyKey: 'idempotency-one', session: firstSession, input: { text: 'one' } }),
      adapter.startRun({ applicationRunId: 'application-two', idempotencyKey: 'idempotency-two', session: secondSession, input: { text: 'two' } }),
    ]);

    expect(first.applicationRunId).toBe('application-one');
    expect(second.applicationRunId).toBe('application-two');
    expect([...server.receivedIdempotencyKeys].sort()).toEqual(['idempotency-one', 'idempotency-two']);
    expect(server.pendingRequestCount).toBe(0);
    expect(server.openConnectionCount).toBe(1);
    await adapter.close();
  });

  it('normalizes malformed fake OpenClaw frames and releases the socket', async () => {
    const server = new FakeOpenClawV3Server({ failureMode: 'malformed-frame' });
    const adapter = new OpenClawAdapter(createTestDependencies({ webSockets: server }), { protocols: [openClawV3Codec()] });
    await expect(adapter.connect(server.createTarget().connection)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(server.openConnectionCount).toBe(0);
    expect(server.pendingRequestCount).toBe(0);
  });

  it('simulates Hermes event-buffer expiry with status reconciliation', async () => {
    const server = new FakeHermesServer();
    server.eventStreamFailures = 1;
    server.runs.set('run-expired', { id: 'run-expired', status: 'completed', output: 'reconciled', sessionId: 'session-expired', events: [] });
    const adapter = new HermesAdapter(createTestDependencies({ http: server }), {
      baseUrl: 'https://hermes.example.test',
      maxReconnectAttempts: 0,
      pollingIntervalMs: 1,
      maxReconciliationMs: 20,
    });
    await adapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    const events = [];
    for await (const event of adapter.streamRun({ applicationRunId: 'application-expired', externalRunId: 'run-expired', externalSessionId: 'session-expired' })) events.push(event);
    expect(events).toMatchObject([{ type: 'run.completed', output: 'reconciled' }]);
    expect(server.streamRequests).toBe(1);
    expect(server.statusRequests).toBe(1);
    expect(server.activeResponseBodies).toBe(0);
    await adapter.close();
  });
});
