import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  RuntimeError,
  type RuntimeClock,
  type RuntimeHttpRequest,
  type RuntimeHttpResponse,
  type RuntimeHttpTransport,
} from '@banzae/agent-runtime-core';
import { createTestDependencies } from '@banzae/agent-runtime-core/testing';
import { FakeHermesServer } from '../../testing/src/fake-hermes-server.js';
import { HermesAdapter } from './hermes-adapter.js';
import { HermesHttpClient } from './http/client.js';
import { isHermesCapabilities, mapHermesCapabilities } from './mapping/capabilities.js';
import { mapHermesSseEvent } from './mapping/events.js';
import { parseSseStream } from './sse/parser.js';

async function* chunks(values: string[]): AsyncIterable<Uint8Array> {
  for (const value of values) yield new TextEncoder().encode(value);
}

function capabilities(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    object: 'hermes.api_server.capabilities',
    platform: 'hermes-agent',
    features: {
      run_submission: true,
      run_status: true,
      run_events_sse: true,
      run_stop: true,
      run_approval_response: true,
      approval_events: true,
      tool_progress_events: true,
      session_continuity_header: 'X-Hermes-Session-Id',
      session_key_header: 'X-Hermes-Session-Key',
    },
    endpoints: {
      runs: { method: 'POST', path: '/v1/runs' },
      run_status: { method: 'GET', path: '/v1/runs/{run_id}' },
      run_events: { method: 'GET', path: '/v1/runs/{run_id}/events' },
      run_stop: { method: 'POST', path: '/v1/runs/{run_id}/stop' },
      run_approval: { method: 'POST', path: '/v1/runs/{run_id}/approval' },
      session_create: { method: 'POST', path: '/api/sessions' },
      session_messages: { method: 'GET', path: '/api/sessions/{session_id}/messages' },
    },
    ...overrides,
  };
}

function eventContext() {
  return {
    ids: { id: () => 'event-1' },
    clock: { now: () => new Date('2026-01-01T00:00:00.000Z'), sleep: async () => undefined },
    applicationRunId: 'app-run-1',
    externalRunId: 'run-1',
    externalSessionId: 'session-1',
    pendingApprovalIds: [] as string[],
    pendingToolIds: new Map<string, string[]>(),
  };
}

function testClock(): RuntimeClock & { sleeps: number[] } {
  let now = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => new Date(now),
    sleep: async (ms, signal) => {
      if (signal?.aborted) throw signal.reason;
      sleeps.push(ms);
      now += ms;
    },
  };
}

describe('Hermes contract hardening', () => {
  it('maps every capability fail-closed and independently', () => {
    const empty = mapHermesCapabilities(capabilities({ features: { run_submission: false, run_status: false } , endpoints: {} }));
    expect(empty.sessions).toEqual({ create: false, resume: false, history: false, fork: false });
    expect(empty.runs).toEqual({ start: false, status: false, stream: false, cancel: false, approvals: false });
    expect(empty.output.usage).toBe(false);

    const partial = mapHermesCapabilities(capabilities({
      features: { run_submission: true, run_status: false, run_events_sse: false },
      endpoints: { runs: { method: 'POST', path: '/v1/runs' } },
    }));
    expect(partial.runs.start).toBe(true);
    expect(partial.runs.status).toBe(false);
    expect(partial.runs.stream).toBe(false);
    expect(partial.sessions.create).toBe(false);
    expect(partial.sessions.history).toBe(false);

    const missing = mapHermesCapabilities(capabilities({
      features: { reasoning: false, responses_api: false },
      endpoints: {},
    }));
    expect(missing.runs).toEqual({ start: false, status: false, stream: false, cancel: false, approvals: false });
    expect(missing.extensions).toMatchObject({
      'hermes.long_term_session_key': false,
      'hermes.session_id_header': false,
    });

    for (const [features, endpoints] of [
      [{ run_approval_response: true, approval_events: true }, {}],
      [{ run_approval_response: true, run_status: true }, { run_approval: { method: 'POST', path: '/v1/runs/{run_id}/approval' } }],
      [{ approval_events: true, run_status: true }, { run_approval: { method: 'POST', path: '/v1/runs/{run_id}/approval' } }],
    ] as const) {
      expect(mapHermesCapabilities(capabilities({ features, endpoints })).runs.approvals).toBe(false);
    }
  });

  it('rejects malformed and misleading partial capabilities', () => {
    expect(isHermesCapabilities({ object: 'hermes.api_server.capabilities', platform: 'hermes-agent', features: { run_submission: true } })).toBe(false);
    expect(() => mapHermesCapabilities(capabilities({ features: { run_submission: 'yes', run_status: true } }))).toThrowError(RuntimeError);
    expect(() => mapHermesCapabilities(capabilities({ endpoints: { runs: { method: 'GET', path: '/v1/runs' } } }))).toThrowError(RuntimeError);
  });

  it('publishes missing and partial capabilities fail-closed through connect()', async () => {
    const server = new FakeHermesServer();
    server.capabilities = capabilities({
      features: { run_submission: false, run_status: false, run_approval_response: true, approval_events: false },
      endpoints: { run_approval: { method: 'POST', path: '/v1/runs/{run_id}/approval' } },
    });
    const adapter = new HermesAdapter(createTestDependencies({ http: server }), { baseUrl: 'https://hermes.example.test' });
    await adapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    const mapped = await adapter.capabilities();
    expect(mapped.runs).toEqual({ start: false, status: false, stream: false, cancel: false, approvals: false });
    expect(mapped.sessions).toEqual({ create: false, resume: false, history: false, fork: false });
    expect(mapped.output.usage).toBe(false);
    expect(mapped.extensions).toMatchObject({
      'hermes.long_term_session_key': false,
      'hermes.session_id_header': false,
    });
  });

  it('does not treat a sanitized capabilities-only capture as a live adapter suite', async () => {
    const fixture = JSON.parse(await readFile(new URL('../../../fixtures/hermes/bfp1-capabilities.json', import.meta.url), 'utf8')) as { capabilities: { body: unknown } };
    expect(isHermesCapabilities(fixture.capabilities.body)).toBe(false);
    const synthetic = JSON.parse(await readFile(new URL('../../../fixtures/hermes/capabilities.json', import.meta.url), 'utf8')) as { metadata: Record<string, unknown> };
    expect(synthetic.metadata).toMatchObject({ source: 'synthetic', validatedRuntimeVersion: null });
    const compatibility = await readFile(new URL('../../../docs/compatibility.md', import.meta.url), 'utf8');
    expect(compatibility).not.toContain('| Hermes | HTTP/SSE Runs API | supported |');
  });

  it('uses client-scoped auto mode unless both REST session endpoints are advertised', async () => {
    const server = new FakeHermesServer();
    server.capabilities = capabilities({
      endpoints: {
        runs: { method: 'POST', path: '/v1/runs' },
        run_status: { method: 'GET', path: '/v1/runs/{run_id}' },
        run_events: { method: 'GET', path: '/v1/runs/{run_id}/events' },
      },
    });
    const adapter = new HermesAdapter(createTestDependencies({ http: server }), { baseUrl: 'https://hermes.example.test' });
    await adapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    const session = await adapter.ensureSession({ applicationSessionId: 'app-session' });
    expect(session).toMatchObject({ externalSessionId: 'app-session', created: false });
    expect(server.sessionsCreated).toBe(0);
  });

  it('rejects explicit REST session mode when creation or history is unavailable', async () => {
    const server = new FakeHermesServer();
    server.capabilities = capabilities({ endpoints: { session_create: { method: 'POST', path: '/api/sessions' } } });
    const adapter = new HermesAdapter(createTestDependencies({ http: server }), { baseUrl: 'https://hermes.example.test', sessionMode: 'rest-session' });
    await expect(adapter.connect({ target: { endpoint: 'https://hermes.example.test' } })).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' });
    expect((await adapter.capabilities()).sessions).toEqual({ create: false, resume: false, history: false, fork: false });
  });

  it('connects, creates REST sessions, and preserves exact idempotency keys', async () => {
    const server = new FakeHermesServer();
    const adapter = new HermesAdapter(createTestDependencies({ http: server }), { baseUrl: 'https://hermes.example.test' });
    const info = await adapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    expect(info.descriptor.capabilities.sessions).toMatchObject({ create: true, history: true });
    const session = await adapter.ensureSession({ applicationSessionId: 'app-session' });
    const handle = await adapter.startRun({ applicationRunId: 'app-run', idempotencyKey: 'caller-idem', session, input: { text: 'hello' } });
    expect(handle.externalRunId).toBe('run-2');
    expect(handle.sessionStatePatch?.previousResponseId).toBeUndefined();
    expect(server.requests.find((request) => new URL(request.url).pathname === '/v1/runs')?.headers?.['Idempotency-Key']).toBe('caller-idem');
  });

  it('accepts caller previous_response_id but never invents its successor', async () => {
    const server = new FakeHermesServer();
    const adapter = new HermesAdapter(createTestDependencies({ http: server }), { baseUrl: 'https://hermes.example.test' });
    await adapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    const session = { applicationSessionId: 's', externalSessionId: 's', created: false, providerState: { previousResponseId: 'resp-caller' } };
    const handle = await adapter.startRun({ applicationRunId: 'r', idempotencyKey: 'i', session, input: { text: 'next' } });
    const request = server.requests.find((item) => new URL(item.url).pathname === '/v1/runs' && item.method === 'POST');
    expect(JSON.parse(String(request?.body))).toMatchObject({ previous_response_id: 'resp-caller' });
    expect(handle.sessionStatePatch?.previousResponseId).toBeUndefined();
    const snapshot = await adapter.getRun({ applicationRunId: 'r', externalRunId: handle.externalRunId, externalSessionId: 's' });
    expect(snapshot.sessionStatePatch?.previousResponseId).toBeUndefined();
  });

  it('maps only source-backed Runs events and records mismatched correlation safely', () => {
    const [delta] = mapHermesSseEvent(undefined, { event: 'message.delta', run_id: 'run-1', delta: 'hi' }, eventContext());
    expect(delta).toMatchObject({ type: 'assistant.delta', delta: 'hi', occurredAt: '2026-01-01T00:00:00.000Z' });
    const [wrong] = mapHermesSseEvent(undefined, { event: 'message.delta', run_id: 'other', delta: 'bad' }, eventContext());
    expect(wrong).toMatchObject({ type: 'transport.warning', warning: 'Ignored Hermes event for another run' });
    expect(() => mapHermesSseEvent(undefined, { event: 'message.delta', delta: 'bad' }, eventContext())).toThrowError(RuntimeError);
  });

  it('parses split UTF-8, CRLF, multiline data, keepalives, and a final event', async () => {
    const output = [];
    for await (const event of parseSseStream(chunks(['\uFEFF: ping\r\nid: 1\r\nevent: x\r\ndata: hel', 'lo\r\ndata: world']))) output.push(event);
    expect(output).toEqual([{ id: '1', event: 'x', data: 'hello\nworld' }]);
  });

  it.each([
    [{ action: 'allow', scope: 'once' } as const, 'once'],
    [{ action: 'allow', scope: 'session' } as const, 'session'],
    [{ action: 'allow', scope: 'always' } as const, 'always'],
    [{ action: 'deny' } as const, 'deny'],
  ])('maps provider-neutral approval decision %j to Hermes %s', async (decision, expectedChoice) => {
    const server = new FakeHermesServer();
    server.runs.set('run-approval', {
      id: 'run-approval',
      status: 'waiting_for_approval',
      sessionId: 'session-1',
      events: [{ data: { event: 'approval.request', run_id: 'run-approval', description: 'Approve action', choices: ['once', 'session', 'always', 'deny'] } }],
    });
    const adapter = new HermesAdapter(createTestDependencies({ http: server }), { baseUrl: 'https://hermes.example.test' });
    await adapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    const iterator = adapter.streamRun({ applicationRunId: 'app', externalRunId: 'run-approval', externalSessionId: 'session-1' })[Symbol.asyncIterator]();
    const event = (await iterator.next()).value;
    expect(event?.type).toBe('approval.required');
    if (event?.type !== 'approval.required') throw new Error('expected approval event');
    await adapter.resolveApproval({ applicationRunId: 'app', externalRunId: 'run-approval', approvalId: event.approvalId, decision });
    expect(server.approvalBodies.at(-1)).toEqual({ choice: expectedChoice });
    await iterator.return?.();
  });

  it('enforces approval choices offered by the specific event', async () => {
    const server = new FakeHermesServer();
    server.runs.set('run-restricted', {
      id: 'run-restricted', status: 'waiting_for_approval', sessionId: 's',
      events: [{ data: { event: 'approval.request', run_id: 'run-restricted', choices: ['once', 'deny'] } }],
    });
    const adapter = new HermesAdapter(createTestDependencies({ http: server }), { baseUrl: 'https://hermes.example.test' });
    await adapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    const iterator = adapter.streamRun({ applicationRunId: 'a', externalRunId: 'run-restricted', externalSessionId: 's' })[Symbol.asyncIterator]();
    const event = (await iterator.next()).value;
    if (event?.type !== 'approval.required') throw new Error('expected approval event');
    expect(event.availableDecisions).toEqual([{ action: 'allow', scope: 'once' }, { action: 'deny' }]);
    await expect(adapter.resolveApproval({ applicationRunId: 'a', externalRunId: 'run-restricted', approvalId: event.approvalId, decision: { action: 'allow', scope: 'always' } })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(adapter.resolveApproval({ applicationRunId: 'a', externalRunId: 'run-restricted', approvalId: 'unknown-approval', decision: { action: 'deny' } })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await iterator.return?.();
  });

  it('rejects malformed approval responses and disabled approval capability', async () => {
    const server = new FakeHermesServer();
    server.approvalResponse = { accepted: true };
    server.runs.set('run-a', { id: 'run-a', status: 'waiting_for_approval', sessionId: 's', events: [{ data: { event: 'approval.request', run_id: 'run-a', choices: ['deny'] } }] });
    const adapter = new HermesAdapter(createTestDependencies({ http: server }), { baseUrl: 'https://hermes.example.test' });
    await adapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    const iterator = adapter.streamRun({ applicationRunId: 'a', externalRunId: 'run-a', externalSessionId: 's' })[Symbol.asyncIterator]();
    const event = (await iterator.next()).value;
    if (event?.type !== 'approval.required') throw new Error('expected approval event');
    await expect(adapter.resolveApproval({ applicationRunId: 'a', externalRunId: 'run-a', approvalId: event.approvalId, decision: { action: 'deny' } })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await iterator.return?.();

    const disabled = new FakeHermesServer();
    disabled.capabilities = capabilities({ features: { run_submission: true, run_status: true, run_approval_response: false, approval_events: true } });
    const disabledAdapter = new HermesAdapter(createTestDependencies({ http: disabled }), { baseUrl: 'https://hermes.example.test' });
    await disabledAdapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    await expect(disabledAdapter.resolveApproval({ applicationRunId: 'a', externalRunId: 'r', approvalId: 'p', decision: { action: 'deny' } })).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' });
  });

  it('reconciles a disconnected stream with terminal status', async () => {
    const server = new FakeHermesServer();
    server.runs.set('run-complete', { id: 'run-complete', status: 'completed', sessionId: 's', output: 'done', usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 }, events: [] });
    const adapter = new HermesAdapter(createTestDependencies({ http: server }), { baseUrl: 'https://hermes.example.test', maxReconnectAttempts: 0, pollingIntervalMs: 1, maxReconciliationMs: 10 });
    await adapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    const events = [];
    for await (const event of adapter.streamRun({ applicationRunId: 'a', externalRunId: 'run-complete', externalSessionId: 's' })) events.push(event);
    expect(events.at(-1)).toMatchObject({ type: 'run.completed', output: 'done', usage: { total_tokens: 3 } });
  });

  it('enforces reconnect limit and reconnectDelayMs', async () => {
    const server = new FakeHermesServer();
    server.runs.set('run-reconnect', { id: 'run-reconnect', status: 'running', sessionId: 's', events: [] });
    const clock = testClock();
    const transport: RuntimeHttpTransport = {
      request: async (input) => {
        const response = await server.request(input);
        if (new URL(input.url).pathname.endsWith('/events') && server.streamRequests === 2) {
          const run = server.runs.get('run-reconnect');
          if (run) { run.status = 'completed'; run.output = 'after reconnect'; }
        }
        return response;
      },
    };
    const adapter = new HermesAdapter(createTestDependencies({ http: transport, clock }), { baseUrl: 'https://hermes.example.test', maxReconnectAttempts: 1, reconnectDelayMs: 7, pollingIntervalMs: 3, maxReconciliationMs: 30 });
    await adapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    const events = [];
    for await (const event of adapter.streamRun({ applicationRunId: 'a', externalRunId: 'run-reconnect', externalSessionId: 's' })) events.push(event);
    expect(server.streamRequests).toBe(2);
    expect(clock.sleeps).toContain(7);
    expect(events.at(-1)?.type).toBe('run.completed');
  });

  it('uses Retry-After for retryable stream failures', async () => {
    const server = new FakeHermesServer();
    server.runs.set('run-rate', {
      id: 'run-rate',
      status: 'running',
      sessionId: 's',
      events: [{ data: { event: 'run.completed', run_id: 'run-rate', output: 'done' } }],
    });
    const clock = testClock();
    let attempts = 0;
    const transport: RuntimeHttpTransport = {
      request: async (input) => {
        if (new URL(input.url).pathname.endsWith('/events') && attempts++ === 0) {
          return { status: 503, headers: { 'content-type': 'application/json', 'retry-after': '0.02' }, body: chunks(['{}']) };
        }
        return server.request(input);
      },
    };
    const adapter = new HermesAdapter(createTestDependencies({ http: transport, clock }), {
      baseUrl: 'https://hermes.example.test',
      maxReconnectAttempts: 1,
      reconnectDelayMs: 1,
      maxReconciliationMs: 100,
    });
    await adapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    const normalized = [];
    for await (const event of adapter.streamRun({ applicationRunId: 'a', externalRunId: 'run-rate', externalSessionId: 's' })) normalized.push(event);
    expect(clock.sleeps).toContain(20);
    expect(normalized.at(-1)?.type).toBe('run.completed');
  });

  it('enforces pollingIntervalMs and maxReconciliationMs', async () => {
    const server = new FakeHermesServer();
    server.runs.set('run-poll', { id: 'run-poll', status: 'running', sessionId: 's', events: [] });
    const clock = testClock();
    const adapter = new HermesAdapter(createTestDependencies({ http: server, clock }), { baseUrl: 'https://hermes.example.test', maxReconnectAttempts: 0, pollingIntervalMs: 4, maxReconciliationMs: 9 });
    await adapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    await expect(async () => {
      for await (const _event of adapter.streamRun({ applicationRunId: 'a', externalRunId: 'run-poll', externalSessionId: 's' })) { /* consume */ }
    }).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(clock.sleeps).toEqual([4, 4, 1]);
  });

  it('does not reconnect malformed SSE or authentication failures', async () => {
    const malformed = new FakeHermesServer();
    malformed.runs.set('run-bad', { id: 'run-bad', status: 'running', sessionId: 's', events: [{ data: 'not-json' }] });
    const malformedAdapter = new HermesAdapter(createTestDependencies({ http: malformed }), { baseUrl: 'https://hermes.example.test', maxReconnectAttempts: 5 });
    await malformedAdapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    await expect(async () => {
      for await (const _event of malformedAdapter.streamRun({ applicationRunId: 'a', externalRunId: 'run-bad', externalSessionId: 's' })) { /* consume */ }
    }).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(malformed.streamRequests).toBe(1);

    const auth = new FakeHermesServer();
    const authAdapter = new HermesAdapter(createTestDependencies({ http: auth }), { baseUrl: 'https://hermes.example.test', bearerToken: 'secret', maxReconnectAttempts: 5 });
    await authAdapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    auth.failAuth = true;
    await expect(async () => {
      for await (const _event of authAdapter.streamRun({ applicationRunId: 'a', externalRunId: 'run-1', externalSessionId: 'session-1' })) { /* consume */ }
    }).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' });
    expect(auth.streamRequests).toBe(0);
  });

  it('uses the bounded dedupe window in the production stream path', async () => {
    const server = new FakeHermesServer();
    server.runs.set('run-volume', { id: 'run-volume', status: 'completed', sessionId: 's', output: 'done' });
    const events = Array.from({ length: 10_000 }, (_, index) => ({
      id: String(index),
      data: { event: 'message.delta', run_id: 'run-volume', delta: String(index) },
    }));
    events.push(
      { id: '9999', data: { event: 'message.delta', run_id: 'run-volume', delta: '9999' } },
      { id: '0', data: { event: 'message.delta', run_id: 'run-volume', delta: '0' } },
      { id: 'terminal', data: { event: 'run.completed', run_id: 'run-volume', output: 'done' } },
    );
    const transport: RuntimeHttpTransport = {
      request: async (input) => new URL(input.url).pathname.endsWith('/events')
        ? chunkedSse(events)
        : server.request(input),
    };
    const adapter = new HermesAdapter(createTestDependencies({ http: transport }), {
      baseUrl: 'https://hermes.example.test',
      maxDeduplicationEntries: 128,
    });
    await adapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    const normalized = [];
    for await (const event of adapter.streamRun({ applicationRunId: 'a', externalRunId: 'run-volume', externalSessionId: 's' })) normalized.push(event);
    expect(normalized.filter((event) => event.type === 'assistant.delta')).toHaveLength(10_001);
    expect(normalized.at(-1)?.type).toBe('run.completed');
  });

  it('rejects strict run, stop, session, and history response mismatches', async () => {
    const server = new FakeHermesServer();
    const transport: RuntimeHttpTransport = {
      request: async (input) => {
        const path = new URL(input.url).pathname;
        if (path === '/v1/runs/bad') return json(200, { run_id: 'bad', status: 'completed' });
        if (path === '/v1/runs/run-1/stop') return json(200, { accepted: true });
        if (path === '/api/sessions/s/messages') return json(200, { messages: [] });
        return server.request(input);
      },
    };
    const adapter = new HermesAdapter(createTestDependencies({ http: transport }), { baseUrl: 'https://hermes.example.test' });
    await adapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    await expect(adapter.getRun({ applicationRunId: 'a', externalRunId: 'bad' })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(adapter.cancelRun({ applicationRunId: 'a', externalRunId: 'run-1' })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(adapter.getHistory({ applicationSessionId: 'a', externalSessionId: 's' })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('failed connect closes the temporary client and leaves the adapter disconnected', async () => {
    const server = new FakeHermesServer();
    server.capabilities = { object: 'hermes.api_server.capabilities', platform: 'hermes-agent', features: [] };
    const adapter = new HermesAdapter(createTestDependencies({ http: server }), { baseUrl: 'https://hermes.example.test' });
    const close = vi.spyOn(HermesHttpClient.prototype, 'close');
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await expect(adapter.connect({ target: { endpoint: 'https://hermes.example.test' } })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
      }
      expect(close).toHaveBeenCalledTimes(3);
    } finally {
      close.mockRestore();
    }
    expect((await adapter.capabilities()).runs).toEqual({ start: false, status: false, stream: false, cancel: false, approvals: false });
    expect(server.requests).toHaveLength(3);
  });

  it('close aborts two concurrent streams and is idempotent', async () => {
    const server = new FakeHermesServer();
    server.runs.set('run-x', {
      id: 'run-x',
      status: 'waiting_for_approval',
      sessionId: 's',
      events: [{ data: { event: 'approval.request', run_id: 'run-x', choices: ['deny'] } }],
    });
    server.runs.set('run-y', { id: 'run-y', status: 'running', sessionId: 's', events: [] });
    const transport: RuntimeHttpTransport = {
      request: async (input) => new URL(input.url).pathname === '/v1/runs/run-y/events' ? hangingSse(input) : server.request(input),
    };
    const adapter = new HermesAdapter(createTestDependencies({ http: transport }), { baseUrl: 'https://hermes.example.test' });
    await adapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    const x = adapter.streamRun({ applicationRunId: 'x', externalRunId: 'run-x', externalSessionId: 's' })[Symbol.asyncIterator]();
    const y = adapter.streamRun({ applicationRunId: 'y', externalRunId: 'run-y', externalSessionId: 's' })[Symbol.asyncIterator]();
    expect((await x.next()).value?.type).toBe('approval.required');
    const pending = Promise.allSettled([y.next()]);
    await Promise.resolve();
    await adapter.close();
    const results = await pending;
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    await expect(adapter.close()).resolves.toBeUndefined();
  });

  it('iterator return releases stream resources without affecting another run', async () => {
    const server = new FakeHermesServer();
    server.runs.set('run-one', { id: 'run-one', status: 'waiting_for_approval', sessionId: 's', events: [{ data: { event: 'approval.request', run_id: 'run-one', choices: ['deny'] } }] });
    server.runs.set('run-two', { id: 'run-two', status: 'completed', sessionId: 's', output: 'two', events: [] });
    const adapter = new HermesAdapter(createTestDependencies({ http: server }), { baseUrl: 'https://hermes.example.test', maxReconnectAttempts: 0, pollingIntervalMs: 1, maxReconciliationMs: 10 });
    await adapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    const one = adapter.streamRun({ applicationRunId: 'one', externalRunId: 'run-one', externalSessionId: 's' })[Symbol.asyncIterator]();
    expect((await one.next()).value?.type).toBe('approval.required');
    await one.return?.();
    await expect(adapter.connect({ target: { endpoint: 'https://hermes.example.test' } })).resolves.toBeDefined();
    const two = [];
    for await (const event of adapter.streamRun({ applicationRunId: 'two', externalRunId: 'run-two', externalSessionId: 's' })) two.push(event);
    expect(two.at(-1)?.type).toBe('run.completed');
  });

  it('deduplicates replayed deltas and terminal events', async () => {
    const server = new FakeHermesServer();
    const delta = { event: 'message.delta', run_id: 'run-dup', delta: 'hi' };
    const terminal = { event: 'run.completed', run_id: 'run-dup', output: 'hi' };
    server.runs.set('run-dup', {
      id: 'run-dup', status: 'completed', sessionId: 's', output: 'hi',
      events: [
        { id: '1', data: delta },
        { id: '1', data: delta },
        { id: '2', data: terminal },
        { id: '2', data: terminal },
      ],
    });
    const adapter = new HermesAdapter(createTestDependencies({ http: server }), { baseUrl: 'https://hermes.example.test' });
    await adapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    const events = [];
    for await (const event of adapter.streamRun({ applicationRunId: 'a', externalRunId: 'run-dup', externalSessionId: 's' })) events.push(event);
    expect(events.map((event) => event.type)).toEqual(['assistant.delta', 'run.completed']);
  });

  it('never advances previousResponseId from response-shaped Hermes fields', async () => {
    const server = new FakeHermesServer();
    const transport: RuntimeHttpTransport = {
      request: async (input) => {
        const path = new URL(input.url).pathname;
        if (path === '/v1/runs' && input.method === 'POST') return json(202, { run_id: 'run-response', status: 'started', response_id: 'resp-create' });
        if (path === '/v1/runs/run-response') return json(200, {
          object: 'hermes.run',
          run_id: 'run-response',
          status: 'completed',
          output: 'done',
          session_id: 's',
          response_id: 'resp-status',
          previous_response_id: 'resp-echo',
        });
        return server.request(input);
      },
    };
    const adapter = new HermesAdapter(createTestDependencies({ http: transport }), { baseUrl: 'https://hermes.example.test' });
    await adapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    const session = { applicationSessionId: 's', externalSessionId: 's', created: false };
    const handle = await adapter.startRun({ applicationRunId: 'a', idempotencyKey: 'i', session, input: { text: 'hi' } });
    const snapshot = await adapter.getRun({ applicationRunId: 'a', externalRunId: handle.externalRunId, externalSessionId: 's' });
    expect(handle.sessionStatePatch?.previousResponseId).toBeUndefined();
    expect(handle.providerState).not.toHaveProperty('previousResponseId');
    expect(snapshot.sessionStatePatch?.previousResponseId).toBeUndefined();
    expect(snapshot.providerState).not.toHaveProperty('previousResponseId');
  });

  it('rejects malformed health and session creation payloads in production paths', async () => {
    const healthServer = new FakeHermesServer();
    healthServer.health = { status: 'ok' };
    const healthAdapter = new HermesAdapter(createTestDependencies({ http: healthServer }), { baseUrl: 'https://hermes.example.test' });
    await healthAdapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    await expect(healthAdapter.health()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    const detailedServer = new FakeHermesServer();
    detailedServer.detailedHealth = { status: 'ok', version: '0.18.2' };
    const detailedAdapter = new HermesAdapter(createTestDependencies({ http: detailedServer }), { baseUrl: 'https://hermes.example.test' });
    await detailedAdapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    await expect(detailedAdapter.health()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    const sessionServer = new FakeHermesServer();
    const transport: RuntimeHttpTransport = {
      request: async (input) => new URL(input.url).pathname === '/api/sessions' && input.method === 'POST'
        ? json(201, { object: 'hermes.session', session: { id: 'missing-source' } })
        : sessionServer.request(input),
    };
    const sessionAdapter = new HermesAdapter(createTestDependencies({ http: transport }), { baseUrl: 'https://hermes.example.test' });
    await sessionAdapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    await expect(sessionAdapter.ensureSession({ applicationSessionId: 'a' })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('caller abort stops polling immediately', async () => {
    const server = new FakeHermesServer();
    server.runs.set('run-abort', { id: 'run-abort', status: 'running', sessionId: 's', events: [] });
    const controller = new AbortController();
    let sleeps = 0;
    const clock: RuntimeClock = {
      now: () => new Date(0),
      sleep: async (_ms, signal) => {
        sleeps += 1;
        controller.abort();
        if (signal?.aborted) throw signal.reason;
      },
    };
    const adapter = new HermesAdapter(createTestDependencies({ http: server, clock }), { baseUrl: 'https://hermes.example.test', maxReconnectAttempts: 0, pollingIntervalMs: 5, maxReconciliationMs: 100 });
    await adapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    await expect(async () => {
      for await (const _event of adapter.streamRun({ applicationRunId: 'a', externalRunId: 'run-abort', externalSessionId: 's' }, { signal: controller.signal })) { /* consume */ }
    }).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(sleeps).toBe(1);
  });

  it('rejects unavailable history and unsafe 257-character session headers', async () => {
    const server = new FakeHermesServer();
    server.capabilities = capabilities({
      endpoints: {
        runs: { method: 'POST', path: '/v1/runs' },
        run_status: { method: 'GET', path: '/v1/runs/{run_id}' },
        run_events: { method: 'GET', path: '/v1/runs/{run_id}/events' },
      },
    });
    const adapter = new HermesAdapter(createTestDependencies({ http: server }), { baseUrl: 'https://hermes.example.test' });
    await adapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    await expect(adapter.getHistory({ applicationSessionId: 'a', externalSessionId: 's' })).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' });

    const advertised = new FakeHermesServer();
    const headerAdapter = new HermesAdapter(createTestDependencies({ http: advertised }), { baseUrl: 'https://hermes.example.test' });
    await headerAdapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    await expect(headerAdapter.startRun({
      applicationRunId: 'a', idempotencyKey: 'i',
      session: { applicationSessionId: 'a', externalSessionId: 'x'.repeat(257), created: false },
      input: { text: 'hi' },
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('normalizes an already-resolved approval conflict without replay', async () => {
    const server = new FakeHermesServer();
    server.approvalStatus = 409;
    server.runs.set('run-resolved', { id: 'run-resolved', status: 'waiting_for_approval', sessionId: 's', events: [{ data: { event: 'approval.request', run_id: 'run-resolved', choices: ['deny'] } }] });
    const adapter = new HermesAdapter(createTestDependencies({ http: server }), { baseUrl: 'https://hermes.example.test' });
    await adapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    const iterator = adapter.streamRun({ applicationRunId: 'a', externalRunId: 'run-resolved', externalSessionId: 's' })[Symbol.asyncIterator]();
    const event = (await iterator.next()).value;
    if (event?.type !== 'approval.required') throw new Error('expected approval event');
    await expect(adapter.resolveApproval({ applicationRunId: 'a', externalRunId: 'run-resolved', approvalId: event.approvalId, decision: { action: 'deny' } })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(server.approvalBodies).toHaveLength(1);
    await iterator.return?.();
  });

  it('treats repeated stop of a confirmed terminal run idempotently', async () => {
    const server = new FakeHermesServer();
    const transport: RuntimeHttpTransport = {
      request: async (input) => new URL(input.url).pathname.endsWith('/stop')
        ? json(404, { error: { code: 'run_not_found' } })
        : server.request(input),
    };
    const adapter = new HermesAdapter(createTestDependencies({ http: transport }), { baseUrl: 'https://hermes.example.test' });
    await adapter.connect({ target: { endpoint: 'https://hermes.example.test' } });
    await expect(adapter.cancelRun({ applicationRunId: 'a', externalRunId: 'run-1', externalSessionId: 'session-1' })).resolves.toBeUndefined();
    await expect(adapter.cancelRun({ applicationRunId: 'a', externalRunId: 'run-1', externalSessionId: 'session-1' })).resolves.toBeUndefined();
  });

  it('ships upstream-reference fixtures for every Hermes approval choice', async () => {
    for (const choice of ['once', 'session', 'always', 'deny']) {
      const fixture = JSON.parse(await readFile(new URL(`../../../fixtures/hermes/approval-response-${choice}.json`, import.meta.url), 'utf8')) as {
        metadata: Record<string, unknown>;
        request: Record<string, unknown>;
        response: Record<string, unknown>;
      };
      expect(fixture.metadata).toMatchObject({ source: 'upstream-reference', upstreamCommit: '226e8de827a669e8ffa7035b27d70c19e44b1208' });
      expect(fixture.request.choice).toBe(choice);
      expect(fixture.response.choice).toBe(choice);
    }
  });
});

function json(status: number, value: unknown): RuntimeHttpResponse {
  return { status, headers: { 'content-type': 'application/json' }, body: chunks([JSON.stringify(value)]) };
}

function hangingSse(input: RuntimeHttpRequest): RuntimeHttpResponse {
  return {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    body: {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<Uint8Array>>((_, reject) => {
            input.signal?.addEventListener('abort', () => reject(input.signal?.reason), { once: true });
          }),
          return: async () => ({ done: true, value: undefined }),
        };
      },
    },
  };
}

function chunkedSse(events: ReadonlyArray<{ id?: string; event?: string; data: unknown }>): RuntimeHttpResponse {
  return {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    body: {
      async *[Symbol.asyncIterator]() {
        for (const event of events) {
          const text = `${event.id ? `id: ${event.id}\n` : ''}${event.event ? `event: ${event.event}\n` : ''}data: ${JSON.stringify(event.data)}\n\n`;
          yield new TextEncoder().encode(text);
        }
      },
    },
  };
}
