import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { RuntimeError, createTestDependencies } from '@banzae/agent-runtime-core';
import { FakeHermesServer } from '../../testing/src/fake-hermes-server.js';
import { HermesAdapter } from './hermes-adapter.js';
import { isHermesCapabilities, mapHermesCapabilities } from './mapping/capabilities.js';
import { mapHermesSseEvent } from './mapping/events.js';
import { parseSseStream } from './sse/parser.js';

async function* chunks(values: string[]): AsyncIterable<Uint8Array> {
  for (const value of values) yield new TextEncoder().encode(value);
}

describe('Hermes adapter foundations', () => {
  it('maps capabilities', () => {
    const capabilities = mapHermesCapabilities({
      object: 'hermes.api_server.capabilities',
      platform: 'hermes-agent',
      features: { run_submission: true, run_events_sse: true, run_stop: true, images: true },
    });
    expect(capabilities.runs.start).toBe(true);
    expect(capabilities.input.images).toBe(false);
    expect(capabilities.input.files).toBe(false);
    expect(capabilities.extensions['hermes.jobs']).toBe(false);
  });

  it('replays the bfp1 live capabilities fixture', async () => {
    const fixture = JSON.parse(
      await readFile(new URL('../../../fixtures/hermes/bfp1-capabilities.json', import.meta.url), 'utf8'),
    ) as { capabilities: { body: unknown }; detailedHealth: { body: Record<string, unknown> } };

    expect(isHermesCapabilities(fixture.capabilities.body)).toBe(true);
    expect(fixture.detailedHealth.body.version).toBe('0.18.2');

    const capabilities = mapHermesCapabilities(fixture.capabilities.body);
    expect(capabilities.runs.start).toBe(true);
    expect(capabilities.runs.status).toBe(true);
    expect(capabilities.runs.streamText).toBe(true);
    expect(capabilities.runs.streamTools).toBe(true);
    expect(capabilities.runs.approvals).toBe(true);
    expect(capabilities.output.tools).toBe(true);
    expect(capabilities.extensions['hermes.sessions_rest']).toBe(true);
  });

  it('requires Hermes identity and feature evidence for capabilities', () => {
    expect(isHermesCapabilities({ capabilities: [], features: { run_submission: true, run_status: true } })).toBe(false);
    expect(isHermesCapabilities({ object: 'hermes.api_server.capabilities', platform: 'hermes-agent', features: { run_submission: true } })).toBe(false);
    expect(isHermesCapabilities({ object: 'hermes.api_server.capabilities', platform: 'hermes-agent', features: { run_submission: true, run_status: true } })).toBe(true);
  });

  it('parses split SSE events', async () => {
    const events = [];
    for await (const event of parseSseStream(chunks(['id: 1\nevent: run.delta\ndata: {"te', 'xt":"hi"}\n\n']))) {
      events.push(event);
    }
    expect(events).toEqual([{ id: '1', event: 'run.delta', data: '{"text":"hi"}' }]);
  });

  it('maps Hermes event names carried in JSON data', () => {
    const [event] = mapHermesSseEvent(undefined, { event: 'message.delta', delta: 'sdk-live-ok' }, {
      ids: { id: () => 'event-1' },
      clock: { now: () => new Date('2026-01-01T00:00:00.000Z'), sleep: async () => undefined },
      applicationRunId: 'run-1',
      externalRunId: 'external-run-1',
      externalSessionId: 'session-1',
    });

    expect(event?.type).toBe('assistant.delta');
    if (event?.type === 'assistant.delta') expect(event.delta).toBe('sdk-live-ok');
  });

  it('connects, negotiates REST sessions, starts text runs, and preserves idempotency keys', async () => {
    const server = new FakeHermesServer();
    const deps = createTestDependencies({ http: server });
    const adapter = new HermesAdapter(deps, { baseUrl: 'https://hermes.example.test' });
    const info = await adapter.connect({ target: { endpoint: 'https://hermes.example.test' }, auth: { kind: 'bearer', token: 'secret' } });
    expect(info.descriptor.capabilities.sessions.history).toBe(true);
    expect(info.descriptor.capabilities.input.images).toBe(false);

    const session = await adapter.ensureSession({ applicationSessionId: 'app-session' });
    expect(session.externalSessionId).toBe('rest-session-1');
    const handle = await adapter.startRun({
      applicationRunId: 'app-run',
      idempotencyKey: 'idem-1',
      session,
      input: { text: 'hello' },
      instructions: 'be brief',
    });
    expect(handle.externalRunId).toBe('run-2');
    expect(handle.sessionStatePatch?.previousResponseId).toBe('resp-run-2');
    expect(server.requests.find((request) => new URL(request.url).pathname === '/v1/runs')?.headers?.['Idempotency-Key']).toBe('idem-1');
  });

  it('reuses existing Hermes REST session provider state', async () => {
    const server = new FakeHermesServer();
    const adapter = new HermesAdapter(createTestDependencies({ http: server }), { baseUrl: 'https://hermes.example.test', sessionMode: 'rest-session' });
    await adapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    const session = await adapter.ensureSession({ applicationSessionId: 'app-session', providerState: { hermesSessionId: 'existing-session' } });
    expect(session.externalSessionId).toBe('existing-session');
    expect(session.created).toBe(false);
    expect(server.sessionsCreated).toBe(0);
  });

  it('streams explicit SSE events, ignores wrong run events, and deduplicates replayed events', async () => {
    const server = new FakeHermesServer();
    server.runs.set('run-stream', {
      id: 'run-stream',
      status: 'completed',
      sessionId: 'session-1',
      events: [
        { id: '1', event: 'assistant.delta', data: { run_id: 'other', session_id: 'session-1', delta: 'bad' } },
        { id: '2', event: 'assistant.delta', data: { run_id: 'run-stream', session_id: 'session-1', delta: 'hi' } },
        { id: '2', event: 'assistant.delta', data: { run_id: 'run-stream', session_id: 'session-1', delta: 'hi' } },
        { id: '3', event: 'run.completed', data: { run_id: 'run-stream', session_id: 'session-1' } },
      ],
    });
    const adapter = new HermesAdapter(createTestDependencies({ http: server }), { baseUrl: 'https://hermes.example.test' });
    await adapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    const events = [];
    for await (const event of adapter.streamRun({ applicationRunId: 'app-run', externalRunId: 'run-stream', externalSessionId: 'session-1' })) events.push(event);
    expect(events.map((event) => event.type)).toEqual(['assistant.delta', 'run.completed']);
  });

  it('reconciles ended SSE streams with run status', async () => {
    const server = new FakeHermesServer();
    server.runs.set('run-reconcile', { id: 'run-reconcile', status: 'completed', sessionId: 'session-1', output: 'done', events: [] });
    const adapter = new HermesAdapter(createTestDependencies({ http: server }), { baseUrl: 'https://hermes.example.test', maxReconnectAttempts: 0 });
    await adapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    const events = [];
    for await (const event of adapter.streamRun({ applicationRunId: 'app-run', externalRunId: 'run-reconcile', externalSessionId: 'session-1' })) events.push(event);
    expect(events.at(-1)?.type).toBe('run.completed');
  });

  it('normalizes history, approvals, cancellation, and unsupported attachments', async () => {
    const server = new FakeHermesServer();
    const adapter = new HermesAdapter(createTestDependencies({ http: server }), { baseUrl: 'https://hermes.example.test' });
    await adapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    const history = await adapter.getHistory({ applicationSessionId: 'app-session', externalSessionId: 'session-1' });
    expect(history[0]).toMatchObject({ role: 'user', content: 'hello' });
    await expect(adapter.resolveApproval?.({ applicationRunId: 'app-run', externalRunId: 'run-1', approvalId: 'approval-1', decision: 'approve' })).resolves.toBeUndefined();
    await expect(adapter.cancelRun({ applicationRunId: 'app-run', externalRunId: 'run-1' })).resolves.toBeUndefined();
    await expect(
      adapter.startRun({
        applicationRunId: 'app-run',
        idempotencyKey: 'idem',
        session: { applicationSessionId: 's', externalSessionId: 's', created: false },
        input: { text: 'hi', attachments: [{ kind: 'image', mimeType: 'image/png', data: new Uint8Array([1]) }] },
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' });
  });

  it('maps ambiguous run creation interruption to OUTCOME_UNKNOWN and redacts provider details', async () => {
    const server = new FakeHermesServer();
    server.nextRunCreateNetworkFailure = true;
    const adapter = new HermesAdapter(createTestDependencies({ http: server }), { baseUrl: 'https://hermes.example.test' });
    await adapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    await expect(
      adapter.startRun({
        applicationRunId: 'app-run',
        idempotencyKey: 'idem-unknown',
        session: { applicationSessionId: 's', externalSessionId: 's', created: false },
        input: { text: 'hi' },
      }),
    ).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
  });

  it('rejects invalid session headers and malformed SSE input safely', async () => {
    const server = new FakeHermesServer();
    const adapter = new HermesAdapter(createTestDependencies({ http: server }), { baseUrl: 'https://hermes.example.test' });
    await adapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    await expect(
      adapter.startRun({
        applicationRunId: 'app-run',
        idempotencyKey: 'idem',
        session: { applicationSessionId: 'bad\nsession', externalSessionId: 's', created: false },
        input: { text: 'hi' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });

    await expect(async () => {
      for await (const _ of parseSseStream(chunks(['data: x\n']), { maxLineBytes: 1 })) {
        // consume
      }
    }).rejects.toBeInstanceOf(RuntimeError);
  });
});
