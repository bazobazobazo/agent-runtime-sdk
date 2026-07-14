import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  RuntimeError,
  createTestDependencies,
  type RuntimeEvent,
  type RuntimeWebSocketConnection,
  type RuntimeWebSocketEvent,
} from '@banzae/agent-runtime-core';
import { OpenClawAdapter, OpenClawProtocolRegistry, OpenClawRequestManager, openClawV3Codec, openClawV4Codec } from './index.js';
import { normalizeOpenClawHistory } from './mapping/transcript.js';
import { classifyNegotiationFailure } from './protocol/negotiation.js';
import { sanitizeOpenClawPayload } from './protocol/shared.js';

describe('OpenClaw protocol scaffolding', () => {
  it('orders codecs newest first', () => {
    const registry = new OpenClawProtocolRegistry();
    registry.register(openClawV3Codec());
    registry.register(openClawV4Codec());
    expect(registry.preferredVersions()).toEqual([4, 3]);
    expect(registry.supportedVersions()).toEqual([3, 4]);
    expect(registry.get(4)).toBeTruthy();
  });

  it('rejects duplicate codec registrations', () => {
    const registry = new OpenClawProtocolRegistry();
    registry.register(openClawV4Codec());
    expect(() => registry.register(openClawV4Codec())).toThrow('Duplicate OpenClaw protocol v4');
  });

  it('fails unknown protocol closed', () => {
    const registry = new OpenClawProtocolRegistry();
    registry.register(openClawV4Codec());
    expect(() => registry.require(5)).toThrow(RuntimeError);
  });

  it('passes caller idempotency key through chat.send', () => {
    const request = openClawV4Codec().buildRunStart({
      applicationRunId: 'run-1',
      idempotencyKey: 'forge-runtime-run:run-1',
      session: { applicationSessionId: 'thread-1', externalSessionId: 'session-1', created: false },
      input: { text: 'hello' },
    });
    expect(request.params?.idempotencyKey).toBe('forge-runtime-run:run-1');
  });

  it.each([
    ['v3', openClawV3Codec(), '../../../fixtures/openclaw/v3'],
    ['v4', openClawV4Codec(), '../../../fixtures/openclaw/v4'],
  ])('validates %s fixture contract', async (_label, codec, basePath) => {
    const challenge = await readFixture(`${basePath}/challenge.json`);
    const connectRequest = await readFixture(`${basePath}/connect-request.json`);
    const helloFixture = await readFixture(`${basePath}/hello.json`);
    const runStartRequest = await readFixture(`${basePath}/run-start-request.json`);
    const runStartResponse = await readFixture(`${basePath}/run-start-response.json`);
    const historyRequest = await readFixture(`${basePath}/history-request.json`);
    const historyResponse = await readFixture(`${basePath}/history-response.json`);
    const cancelRequest = await readFixture(`${basePath}/cancel-request.json`);
    const cancelResponse = await readFixture(`${basePath}/cancel-response.json`);
    const providerErrors = await readFixture(`${basePath}/provider-errors.json`);
    const runEvents = await readJsonlFixture(`${basePath}/run-events.jsonl`);

    expect(codec.parseChallenge(codec.parseFrame(JSON.stringify(challenge.frame)))?.nonce).toBe('fixture-nonce');
    expect(sanitizeOpenClawPayload(codec.createConnectParams({ requestId: 'fixture-connect', auth: { kind: 'token', token: 'secret' } }))).toMatchObject(
      connectRequest.frame.params,
    );
    expect(codec.parseHello(helloFixture.payload).protocolVersion).toBe(codec.protocolVersion);
    expect(codec.buildRunStart(startRunInput())).toEqual(stripReqType(runStartRequest.frame));
    expect(codec.parseRunStartResponse(runStartResponse.payload)).toMatchObject({ externalRunId: 'provider-run-1', status: 'running' });
    expect(codec.buildHistory({ externalSessionId: 'session-1', limit: 25 })).toEqual(stripReqType(historyRequest.frame));
    expect(normalizeOpenClawHistory(historyResponse.payload)).toHaveLength(1);
    expect(codec.buildCancel({ applicationRunId: 'app-run', externalRunId: 'provider-run-1', externalSessionId: 'session-1' })).toEqual(
      stripReqType(cancelRequest.frame),
    );
    expect(codec.parseCancelResponse(cancelResponse.payload).accepted).toBe(true);

    const context = {
      ...runInput('app-run', 'provider-run-1', 'session-1'),
      clock: createTestDependencies().clock,
      ids: createTestDependencies().ids,
    };
    const normalized = runEvents.flatMap((line) => codec.mapProviderEvent(codec.parseFrame(JSON.stringify(line.frame)) as never, context));
    expect(normalized.some((event) => event.type === 'assistant.delta')).toBe(true);
    expect(normalized.some((event) => event.type === 'run.completed')).toBe(true);
    expect(codec.mapError(providerErrors.errors[0]).code).toBe('AUTHENTICATION_FAILED');
    expect(codec.mapError(providerErrors.errors[1]).code).toBe('PROTOCOL_MISMATCH');
  });

  it.each([
    ['v3', openClawV3Codec()],
    ['v4', openClawV4Codec()],
  ])('rejects malformed %s payloads', (_label, codec) => {
    expect(() => codec.parseFrame('{')).toThrow(RuntimeError);
    expect(() => codec.parseHello({ protocol: codec.protocolVersion + 10 })).toThrow(RuntimeError);
    expect(() => codec.parseRunStartResponse({ status: 'running' })).toThrow(RuntimeError);
    expect(codec.mapProviderEvent(codec.parseFrame(JSON.stringify({ event: 'gateway.status', payload: { status: 'ok' } })) as never, eventContext())).toEqual(
      [],
    );
  });

  it('classifies negotiation failures without downgrading auth or malformed frames', () => {
    expect(
      classifyNegotiationFailure(
        new RuntimeError({ code: 'PROTOCOL_MISMATCH', retryable: false, adapterId: 'openclaw', message: 'bad protocol' }),
      ),
    ).toBe('try-next-protocol');
    expect(
      classifyNegotiationFailure(
        new RuntimeError({ code: 'AUTHENTICATION_FAILED', retryable: false, adapterId: 'openclaw', message: 'bad token' }),
      ),
    ).toBe('fail-closed');
    expect(
      classifyNegotiationFailure(
        new RuntimeError({ code: 'PROVIDER_ERROR', retryable: false, adapterId: 'openclaw', message: 'malformed hello' }),
      ),
    ).toBe('fail-closed');
  });

  it('sanitizes nested credential-like fixture payloads', () => {
    expect(
      sanitizeOpenClawPayload({
        nested: [{ authorization: 'Bearer secret', child: { apiKey: 'key', text: 'ok' } }],
        host: 'bfp1.banzae.dev',
        deviceToken: 'device-secret',
      }),
    ).toEqual({
      nested: [{ authorization: '[redacted]', child: { apiKey: '[redacted]', text: 'ok' } }],
      host: 'runtime.example.test',
      deviceToken: '[redacted]',
    });
  });

  it('negotiates v4 first and stores the selected protocol in the descriptor', async () => {
    const connection = handshakeConnection(4);
    const adapter = adapterWithConnections([connection]);

    const info = await adapter.connect(connectionConfig());

    expect(info.descriptor.protocolName).toBe('openclaw-gateway-v4');
    expect(info.descriptor.protocolVersion).toBe('4');
    expect(connection.sent).toHaveLength(1);
  });

  it('opens a fresh socket when v4 mismatches and then negotiates v3', async () => {
    const first = handshakeConnection(3);
    const second = handshakeConnection(3);
    const adapter = adapterWithConnections([first, second]);

    const info = await adapter.connect(connectionConfig());

    expect(info.descriptor.protocolName).toBe('openclaw-gateway-v3');
    expect(first.sent).toHaveLength(1);
    expect(second.sent).toHaveLength(1);
  });

  it('does not downgrade on authentication failure', async () => {
    const first = handshakeConnection(4, { error: { code: 'AUTHENTICATION_FAILED', message: 'authentication failed' } });
    const second = handshakeConnection(3);
    const adapter = adapterWithConnections([first, second]);

    await expect(adapter.connect(connectionConfig())).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' });
    expect(second.sent).toHaveLength(0);
  });

  it('does not downgrade on malformed hello responses', async () => {
    const first = handshakeConnection(4, { malformedHello: true });
    const second = handshakeConnection(3);
    const adapter = adapterWithConnections([first, second]);

    await expect(adapter.connect(connectionConfig())).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(second.sent).toHaveLength(0);
  });

  it('includes the session key when aborting OpenClaw chat runs', () => {
    const request = openClawV4Codec().buildCancel({
      applicationRunId: 'run-1',
      externalRunId: 'provider-run-1',
      externalSessionId: 'session-1',
    });

    expect(request).toMatchObject({
      method: 'chat.abort',
      params: {
        sessionKey: 'session-1',
        runId: 'provider-run-1',
      },
    });
  });

  it('maps structured protocol mismatch provider errors', () => {
    const mapped = openClawV4Codec().mapError({
      code: 'INVALID_REQUEST',
      message: 'protocol mismatch',
      details: { expectedProtocol: 3 },
    });

    expect(mapped.code).toBe('PROTOCOL_MISMATCH');
    expect(mapped.message).toBe('OpenClaw protocol negotiation failed');
    expect(mapped.details?.expectedProtocol).toBe(3);
  });

  it('maps pairing-required provider errors', () => {
    const mapped = openClawV3Codec().mapError({
      code: 'NOT_PAIRED',
      message: 'pairing required: device is not approved yet',
      details: {
        code: 'PAIRING_REQUIRED',
        requestId: 'pairing-request-1',
        deviceId: 'device-1',
        requestedRole: 'operator',
      },
    });

    expect(mapped.code).toBe('PAIRING_REQUIRED');
    expect(mapped.message).toContain('pairing is required');
    expect(mapped.details?.requestId).toBe('pairing-request-1');
  });

  it('normalizes history without exposing provider types', () => {
    expect(
      normalizeOpenClawHistory({
        messages: [{ id: '1', role: 'assistant', content: [{ text: 'hello' }] }],
      }),
    ).toEqual([
      {
        id: '1',
        role: 'assistant',
        content: 'hello',
        createdAt: undefined,
        metadata: { provider: 'openclaw', runId: undefined, sequence: undefined },
      },
    ]);
  });

  it('replays the bf1 protocol v3 live hello fixture', async () => {
    const hello = await readHelloFixture('../../../fixtures/openclaw-v3/bf1-live-capture.json', openClawV3Codec());

    expect(hello.protocolVersion).toBe(3);
    expect(hello.runtimeVersion).toBe('2026.4.22');
    expect(hello.methods).toContain('chat.send');
    expect(hello.methods).toContain('agent.wait');
    expect(hello.events).toContain('connect.challenge');
  });

  it('replays the bfp1 protocol v3 live hello fixture', async () => {
    const hello = await readHelloFixture('../../../fixtures/openclaw-v3/bfp1-live-capture.json', openClawV3Codec());

    expect(hello.protocolVersion).toBe(3);
    expect(hello.runtimeVersion).toBe('2026.5.6');
    expect(hello.methods).toContain('tools.invoke');
    expect(hello.methods).toContain('gateway.restart.request');
    expect(hello.events).toContain('voicewake.routing.changed');
  });

  it('replays the bfp1 protocol v4 live hello fixture', async () => {
    const hello = await readHelloFixture('../../../fixtures/openclaw-v4/bfp1-live-capture.json', openClawV4Codec());

    expect(hello.protocolVersion).toBe(4);
    expect(hello.runtimeVersion).toBe('2026.6.11');
    expect(hello.methods).toContain('chat.startup');
    expect(hello.methods).toContain('plugins.sessionAction');
    expect(hello.events).toContain('session.operation');
    expect(hello.events).toContain('talk.event');
  });
});

describe('OpenClawRequestManager dispatcher behavior', () => {
  it('receives a response that arrives immediately during send', async () => {
    const connection = new FakeWebSocketConnection();
    const dispatcher = createDispatcher(connection);
    connection.onSend = (data) => {
      const request = JSON.parse(String(data)) as { id: string };
      connection.pushMessage(responseFrame(request.id, { ok: true }));
    };

    await expect(dispatcher.request({ id: 'req-1', method: 'test.now' })).resolves.toEqual({ ok: true });
    expect(dispatcherStats(dispatcher).pendingRequestCount).toBe(0);
    expect(connection.eventsCallCount).toBe(1);
  });

  it('routes two concurrent responses that arrive in reverse order', async () => {
    const connection = new FakeWebSocketConnection();
    const dispatcher = createDispatcher(connection);

    const first = dispatcher.request<{ value: number }>({ id: 'req-1', method: 'test.one' });
    const second = dispatcher.request<{ value: number }>({ id: 'req-2', method: 'test.two' });
    await nextTick();

    connection.pushMessage(responseFrame('req-2', { value: 2 }));
    connection.pushMessage(responseFrame('req-1', { value: 1 }));

    await expect(first).resolves.toEqual({ value: 1 });
    await expect(second).resolves.toEqual({ value: 2 });
    expect(dispatcherStats(dispatcher).pendingRequestCount).toBe(0);
  });

  it('routes provider events separately between request and response frames', async () => {
    const connection = new FakeWebSocketConnection();
    const dispatcher = createDispatcher(connection);
    const iterator = dispatcher.subscribe({ event: 'chat.delta' })[Symbol.asyncIterator]();

    const request = dispatcher.request<{ done: boolean }>({ id: 'req-1', method: 'test.event' });
    await nextTick();
    connection.pushMessage(eventFrame('chat.delta', { text: 'hello' }));
    const event = await iterator.next();
    connection.pushMessage(responseFrame('req-1', { done: true }));

    expect(event.value).toMatchObject({ type: 'event', event: 'chat.delta', payload: { text: 'hello' } });
    await expect(request).resolves.toEqual({ done: true });
    await iterator.return?.();
    expect(dispatcherStats(dispatcher).subscriberCount).toBe(0);
  });

  it('times out one request without affecting another request', async () => {
    const connection = new FakeWebSocketConnection();
    const dispatcher = createDispatcher(connection);

    const timingOut = dispatcher.request({ id: 'req-timeout', method: 'test.timeout' }, { timeoutMs: 15 });
    timingOut.catch(() => undefined);
    const completing = dispatcher.request<{ ok: boolean }>({ id: 'req-ok', method: 'test.ok' });
    await sleep(20);
    connection.pushMessage(responseFrame('req-ok', { ok: true }));

    await expect(timingOut).rejects.toMatchObject({ code: 'TIMEOUT' });
    await expect(completing).resolves.toEqual({ ok: true });
    expect(dispatcherStats(dispatcher).pendingRequestCount).toBe(0);
  });

  it('removes an aborted request from the pending map', async () => {
    const connection = new FakeWebSocketConnection();
    const dispatcher = createDispatcher(connection);
    const abort = new AbortController();
    const request = dispatcher.request({ id: 'req-abort', method: 'test.abort' }, { signal: abort.signal });
    await nextTick();

    abort.abort();

    await expect(request).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(dispatcherStats(dispatcher).pendingRequestCount).toBe(0);
  });

  it('rejects every pending request when the socket closes', async () => {
    const connection = new FakeWebSocketConnection();
    const dispatcher = createDispatcher(connection);

    const first = dispatcher.request({ id: 'req-1', method: 'test.one' });
    const second = dispatcher.request({ id: 'req-2', method: 'test.two' });
    await nextTick();
    connection.pushClose(1008, 'policy');

    await expect(first).rejects.toMatchObject({ code: 'NETWORK' });
    await expect(second).rejects.toMatchObject({ code: 'NETWORK' });
    expect(dispatcherStats(dispatcher).pendingRequestCount).toBe(0);
  });

  it('removes subscriber resources when an iterator is cancelled', async () => {
    const connection = new FakeWebSocketConnection();
    const dispatcher = createDispatcher(connection);
    const iterator = dispatcher.subscribe()[Symbol.asyncIterator]();
    expect(dispatcherStats(dispatcher).subscriberCount).toBe(1);

    await iterator.return?.();

    expect(dispatcherStats(dispatcher).subscriberCount).toBe(0);
  });

  it('does not accumulate WebSocket event iterators across 1,000 sequential requests', async () => {
    const connection = new FakeWebSocketConnection();
    const dispatcher = createDispatcher(connection);
    connection.onSend = (data) => {
      const request = JSON.parse(String(data)) as { id: string };
      connection.pushMessage(responseFrame(request.id, { ok: true }));
    };

    for (let index = 0; index < 1_000; index += 1) {
      await expect(dispatcher.request({ id: `req-${index}`, method: 'test.repeat' })).resolves.toEqual({ ok: true });
    }

    expect(connection.eventsCallCount).toBe(1);
    expect(connection.activeEventIteratorCount).toBe(1);
    expect(dispatcherStats(dispatcher).pendingRequestCount).toBe(0);
  });

  it('rejects oversized frames', async () => {
    const connection = new FakeWebSocketConnection();
    const dispatcher = createDispatcher(connection, { maxFrameBytes: 8 });
    const request = dispatcher.request({ id: 'req-oversized', method: 'test.large' });
    await nextTick();

    connection.pushMessage(responseFrame('req-oversized', { value: 'too-large' }));

    await expect(request).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(dispatcherStats(dispatcher).pendingRequestCount).toBe(0);
  });

  it('never treats provider events as RPC responses', async () => {
    const connection = new FakeWebSocketConnection();
    const dispatcher = createDispatcher(connection);
    let settled = false;
    const request = dispatcher.request<{ ok: boolean }>({ id: 'req-1', method: 'test.event' }).then((value) => {
      settled = true;
      return value;
    });
    await nextTick();

    connection.pushMessage(eventFrame('chat.completed', { id: 'req-1', ok: false }));
    await nextTick();
    expect(settled).toBe(false);
    expect(dispatcherStats(dispatcher).pendingRequestCount).toBe(1);

    connection.pushMessage(responseFrame('req-1', { ok: true }));
    await expect(request).resolves.toEqual({ ok: true });
  });
});

describe('OpenClaw run event correlation', () => {
  it('keeps two simultaneous runs in different sessions isolated', async () => {
    const harness = createAdapterHarness();
    const first = collectRunEvents(harness.adapter.streamRun(runInput('app-1', 'provider-1', 'session-1')));
    const second = collectRunEvents(harness.adapter.streamRun(runInput('app-2', 'provider-2', 'session-2')));
    await nextTick();

    harness.connection.pushMessage(openClawEvent('chat.delta', { runId: 'provider-2', sessionKey: 'session-2', sequence: 1, text: 'two' }));
    harness.connection.pushMessage(openClawEvent('chat.delta', { runId: 'provider-1', sessionKey: 'session-1', sequence: 1, text: 'one' }));
    harness.connection.pushMessage(openClawEvent('chat.completed', { runId: 'provider-1', sessionKey: 'session-1', sequence: 2, text: 'done one' }));
    harness.connection.pushMessage(openClawEvent('chat.completed', { runId: 'provider-2', sessionKey: 'session-2', sequence: 2, text: 'done two' }));

    expect((await first).map((event) => event.applicationRunId)).toEqual(['app-1', 'app-1', 'app-1']);
    expect((await second).map((event) => event.applicationRunId)).toEqual(['app-2', 'app-2', 'app-2']);
  });

  it('keeps two interleaved runs on one session isolated by run id', async () => {
    const harness = createAdapterHarness();
    const first = collectRunEvents(harness.adapter.streamRun(runInput('app-1', 'provider-1', 'session-1')));
    const second = collectRunEvents(harness.adapter.streamRun(runInput('app-2', 'provider-2', 'session-1')));
    await nextTick();

    harness.connection.pushMessage(openClawEvent('chat.delta', { runId: 'provider-1', sessionKey: 'session-1', sequence: 1, text: 'a' }));
    harness.connection.pushMessage(openClawEvent('chat.delta', { runId: 'provider-2', sessionKey: 'session-1', sequence: 1, text: 'b' }));
    harness.connection.pushMessage(openClawEvent('chat.completed', { runId: 'provider-2', sessionKey: 'session-1', sequence: 2, text: 'b done' }));
    harness.connection.pushMessage(openClawEvent('chat.completed', { runId: 'provider-1', sessionKey: 'session-1', sequence: 2, text: 'a done' }));

    expect((await first).filter((event) => event.type === 'assistant.delta')).toMatchObject([{ delta: 'a' }]);
    expect((await second).filter((event) => event.type === 'assistant.delta')).toMatchObject([{ delta: 'b' }]);
  });

  it('ignores unrelated gateway events and wrong run or session events', async () => {
    const harness = createAdapterHarness();
    const events = collectRunEvents(harness.adapter.streamRun(runInput('app-1', 'provider-1', 'session-1')));
    await nextTick();

    harness.connection.pushMessage(openClawEvent('gateway.status', { sequence: 1, text: 'global' }));
    harness.connection.pushMessage(openClawEvent('chat.delta', { runId: 'provider-2', sessionKey: 'session-1', sequence: 2, text: 'wrong run' }));
    harness.connection.pushMessage(openClawEvent('chat.delta', { runId: 'provider-1', sessionKey: 'session-2', sequence: 3, text: 'wrong session' }));
    harness.connection.pushMessage(openClawEvent('chat.delta', { runId: 'provider-1', sessionKey: 'session-1', sequence: 1, text: 'right' }));
    harness.connection.pushMessage(openClawEvent('chat.completed', { runId: 'provider-1', sessionKey: 'session-1', sequence: 2, text: 'done' }));

    expect((await events).filter((event) => event.type === 'assistant.delta')).toMatchObject([{ delta: 'right' }]);
  });

  it('routes valid session-scoped events without run ids only to matching sessions', async () => {
    const harness = createAdapterHarness();
    const events = collectRunEvents(harness.adapter.streamRun(runInput('app-1', 'provider-1', 'session-1')));
    await nextTick();

    harness.connection.pushMessage(openClawEvent('chat.delta', { sessionKey: 'session-2', sequence: 1, text: 'wrong' }));
    harness.connection.pushMessage(openClawEvent('chat.delta', { sessionKey: 'session-1', sequence: 1, text: 'session scoped' }));
    harness.connection.pushMessage(openClawEvent('chat.completed', { runId: 'provider-1', sessionKey: 'session-1', sequence: 2, text: 'done' }));

    expect((await events).filter((event) => event.type === 'assistant.delta')).toMatchObject([{ delta: 'session scoped' }]);
  });

  it('deduplicates duplicate deltas and duplicate final events', async () => {
    const harness = createAdapterHarness();
    const events = collectRunEvents(harness.adapter.streamRun(runInput('app-1', 'provider-1', 'session-1')));
    await nextTick();

    harness.connection.pushMessage(openClawEvent('chat.delta', { eventId: 'evt-1', runId: 'provider-1', sessionKey: 'session-1', sequence: 1, text: 'once' }));
    harness.connection.pushMessage(openClawEvent('chat.delta', { eventId: 'evt-1', runId: 'provider-1', sessionKey: 'session-1', sequence: 1, text: 'once' }));
    harness.connection.pushMessage(openClawEvent('chat.completed', { eventId: 'evt-2', runId: 'provider-1', sessionKey: 'session-1', sequence: 2, text: 'done' }));
    harness.connection.pushMessage(openClawEvent('chat.completed', { eventId: 'evt-2', runId: 'provider-1', sessionKey: 'session-1', sequence: 2, text: 'done' }));

    const collected = await events;
    expect(collected.filter((event) => event.type === 'assistant.delta')).toHaveLength(1);
    expect(collected.filter((event) => event.type === 'run.completed')).toHaveLength(1);
  });

  it('detects sequence gaps before continuing the run stream', async () => {
    const harness = createAdapterHarness();
    const events = collectRunEvents(harness.adapter.streamRun(runInput('app-1', 'provider-1', 'session-1')));
    await nextTick();

    harness.connection.pushMessage(openClawEvent('chat.delta', { runId: 'provider-1', sessionKey: 'session-1', sequence: 1, text: 'one' }));
    harness.connection.pushMessage(openClawEvent('chat.delta', { runId: 'provider-1', sessionKey: 'session-1', sequence: 3, text: 'three' }));
    harness.connection.pushMessage(openClawEvent('chat.completed', { runId: 'provider-1', sessionKey: 'session-1', sequence: 4, text: 'done' }));

    expect((await events).find((event) => event.type === 'transport.gap')).toMatchObject({ expected: 2, actual: 3 });
  });

  it('uses unique normalized event ids and the injected clock when provider data is missing', async () => {
    const harness = createAdapterHarness({ now: new Date('2026-01-02T03:04:05.000Z') });
    const events = collectRunEvents(harness.adapter.streamRun(runInput('app-1', 'provider-1', 'session-1')));
    await nextTick();

    harness.connection.pushMessage(openClawEvent('chat.completed', { runId: 'provider-1', sessionKey: 'session-1', sequence: 1, text: 'done' }));

    const collected = await events;
    expect(new Set(collected.map((event) => event.eventId)).size).toBe(collected.length);
    expect(collected.every((event) => event.occurredAt === '2026-01-02T03:04:05.000Z')).toBe(true);
  });

  it('cleans up subscriptions when a stream iterator is cancelled', async () => {
    const harness = createAdapterHarness();
    const iterator = harness.adapter.streamRun(runInput('app-1', 'provider-1', 'session-1'))[Symbol.asyncIterator]();
    const pending = iterator.next();
    pending.catch(() => undefined);
    await nextTick();
    expect(dispatcherStats(harness.dispatcher).subscriberCount).toBe(1);

    await iterator.return?.();

    expect(dispatcherStats(harness.dispatcher).subscriberCount).toBe(0);
  });

  it('propagates socket closure before final output', async () => {
    const harness = createAdapterHarness();
    const iterator = harness.adapter.streamRun(runInput('app-1', 'provider-1', 'session-1'))[Symbol.asyncIterator]();
    const next = iterator.next();
    await nextTick();

    harness.connection.pushClose(1006, 'lost');

    await expect(next).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('rejects provider responses missing a run id and maps uncertain starts', async () => {
    const missing = createAdapterHarness();
    missing.dispatcher.request = async () => ({ status: 'running' });
    await expect(
      missing.adapter.startRun({
        applicationRunId: 'app-1',
        idempotencyKey: 'idem-1',
        session: { applicationSessionId: 'session-1', externalSessionId: 'session-1', created: false },
        input: { text: 'hello' },
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });

    const uncertain = createAdapterHarness();
    uncertain.dispatcher.request = async () => {
      throw new RuntimeError({ code: 'NETWORK', retryable: true, adapterId: 'openclaw', message: 'lost' });
    };
    await expect(
      uncertain.adapter.startRun({
        applicationRunId: 'app-1',
        idempotencyKey: 'idem-1',
        session: { applicationSessionId: 'session-1', externalSessionId: 'session-1', created: false },
        input: { text: 'hello' },
      }),
    ).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
  });

  it('omits raw provider payloads by default and sanitizes them when enabled', async () => {
    const disabled = createAdapterHarness();
    const withoutRaw = collectRunEvents(disabled.adapter.streamRun(runInput('app-1', 'provider-1', 'session-1')));
    await nextTick();
    disabled.connection.pushMessage(openClawEvent('chat.completed', { runId: 'provider-1', sessionKey: 'session-1', sequence: 1, text: 'done', token: 'secret' }));
    expect((await withoutRaw)[0]?.provider?.raw).toBeUndefined();

    const enabled = createAdapterHarness({ includeRawProviderPayload: true });
    const withRaw = collectRunEvents(enabled.adapter.streamRun(runInput('app-1', 'provider-1', 'session-1')));
    await nextTick();
    enabled.connection.pushMessage(
      openClawEvent('chat.completed', {
        runId: 'provider-1',
        sessionKey: 'session-1',
        sequence: 1,
        text: 'done',
        token: 'secret',
        nested: { authorization: 'Bearer secret', ok: true },
      }),
    );
    expect((await withRaw)[0]?.provider?.raw).toMatchObject({
      token: '[redacted]',
      nested: { authorization: '[redacted]', ok: true },
    });
  });

  it('does not advertise image support while run-start drops image attachments', async () => {
    const capabilities = openClawV4Codec().capabilities({ protocolVersion: 4, methods: [], events: [], features: { images: true }, raw: {} });
    expect(capabilities.input.images).toBe(false);
  });

  it('maps missing OpenClaw methods and events fail-closed', () => {
    const capabilities = openClawV4Codec().capabilities({ protocolVersion: 4, methods: [], events: [], features: {}, raw: {} });
    expect(capabilities.sessions).toEqual({ create: false, resume: false, history: false, fork: false });
    expect(capabilities.runs).toEqual({ start: false, status: false, streamText: false, streamTools: false, cancel: false, approvals: false });
    expect(capabilities.input).toEqual({ text: false, images: false, files: false });
    expect(capabilities.output).toMatchObject({ text: false, reasoning: false, tools: false, usage: false });
  });
});

async function readHelloFixture(path: string, codec: ReturnType<typeof openClawV3Codec> | ReturnType<typeof openClawV4Codec>) {
  const fixture = JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8')) as {
    frames: Array<{ direction: string; payload: string }>;
  };
  const serverResponse = fixture.frames
    .filter((frame) => frame.direction === 'server')
    .map((frame) => JSON.parse(frame.payload) as Record<string, unknown>)
    .find((frame) => frame.type === 'res' && frame.id === 'fixture-connect-1');

  expect(serverResponse?.ok).toBe(true);
  return codec.parseHello(serverResponse?.payload);
}

async function readFixture(path: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8')) as Record<string, any>;
}

async function readJsonlFixture(path: string): Promise<Array<Record<string, any>>> {
  const text = await readFile(new URL(path, import.meta.url), 'utf8');
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, any>);
}

function startRunInput() {
  return {
    applicationRunId: 'app-run',
    idempotencyKey: 'idem-1',
    session: { applicationSessionId: 'session-1', externalSessionId: 'session-1', created: false },
    input: { text: 'fixture prompt' },
  };
}

function stripReqType(frame: Record<string, any>) {
  const { type: _type, ...request } = frame;
  return request;
}

function eventContext() {
  const deps = createTestDependencies();
  return {
    ...runInput('app-run', 'provider-run-1', 'session-1'),
    clock: deps.clock,
    ids: deps.ids,
  };
}

function createAdapterHarness(options: { now?: Date; includeRawProviderPayload?: boolean } = {}) {
  const connection = new FakeWebSocketConnection();
  const dispatcher = createDispatcher(connection);
  const now = options.now ?? new Date('2026-01-01T00:00:00.000Z');
  const deps = createTestDependencies({
    clock: {
      now: () => now,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    },
  });
  const adapter = new OpenClawAdapter(deps, {
    includeRawProviderPayload: options.includeRawProviderPayload,
  });
  (
    adapter as unknown as {
      connected: {
        connection: FakeWebSocketConnection;
        codec: ReturnType<typeof openClawV4Codec>;
        hello: { protocolVersion: number; methods: string[]; events: string[]; features: Record<string, unknown>; raw: unknown };
        dispatcher: OpenClawRequestManager;
      };
    }
  ).connected = {
    connection,
    codec: openClawV4Codec(),
    hello: {
      protocolVersion: 4,
      methods: ['chat.send', 'agent.wait', 'chat.history', 'chat.abort'],
      events: ['chat.delta', 'chat.completed', 'chat.failed', 'chat.cancelled'],
      features: {},
      raw: {},
    },
    dispatcher,
  };
  return { adapter, connection, dispatcher, deps };
}

function adapterWithConnections(connections: FakeWebSocketConnection[]): OpenClawAdapter {
  const deps = createTestDependencies({
    webSockets: {
      async connect() {
        const connection = connections.shift();
        if (!connection) throw new RuntimeError({ code: 'RUNTIME_UNAVAILABLE', retryable: true, message: 'No fake socket left' });
        connection.pushMessage(eventFrame('connect.challenge', { nonce: 'fixture-nonce' }));
        return connection;
      },
    },
  });
  return new OpenClawAdapter(deps, { connectTimeoutMs: 100, requestTimeoutMs: 100 });
}

function handshakeConnection(
  selectedProtocol: number,
  options: { error?: Record<string, unknown>; malformedHello?: boolean } = {},
): FakeWebSocketConnection {
  const connection = new FakeWebSocketConnection();
  connection.onSend = (data) => {
    const request = JSON.parse(String(data)) as { id: string; params?: { minProtocol?: number; maxProtocol?: number } };
    if (options.error) {
      connection.pushMessage(JSON.stringify({ type: 'res', id: request.id, error: options.error }));
      return;
    }
    if (options.malformedHello) {
      connection.pushMessage(JSON.stringify({ type: 'res', id: request.id, payload: 'bad hello' }));
      return;
    }
    const requested = request.params?.minProtocol;
    const payload = {
      protocol: selectedProtocol,
      serverVersion: selectedProtocol === 4 ? '2026.6.11' : '2026.4.22',
      methods: ['sessions.create', 'chat.send', 'agent.wait', 'chat.history', 'chat.abort'],
      events: ['connect.challenge', 'chat.delta', 'chat.completed'],
      features: {},
    };
    if (requested !== selectedProtocol) {
      connection.pushMessage(
        JSON.stringify({
          type: 'res',
          id: request.id,
          error: { code: 'INVALID_REQUEST', message: 'protocol mismatch', details: { expectedProtocol: selectedProtocol } },
        }),
      );
      return;
    }
    connection.pushMessage(JSON.stringify({ type: 'res', id: request.id, payload }));
  };
  return connection;
}

function connectionConfig() {
  return { target: { endpoint: 'wss://runtime.example.test/gateway' }, auth: { kind: 'none' as const } };
}

function runInput(applicationRunId: string, externalRunId: string, externalSessionId: string) {
  return { applicationRunId, externalRunId, externalSessionId };
}

async function collectRunEvents(stream: AsyncIterable<RuntimeEvent>): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

function openClawEvent(event: string, payload: Record<string, unknown>): string {
  return JSON.stringify({ type: 'event', event, payload, seq: payload.sequence });
}

function createDispatcher(
  connection: FakeWebSocketConnection,
  options: Partial<ConstructorParameters<typeof OpenClawRequestManager>[2]> = {},
) {
  return new OpenClawRequestManager(connection, openClawV4Codec(), {
    requestTimeoutMs: 100,
    ...options,
  });
}

function responseFrame(id: string, payload: unknown): string {
  return JSON.stringify({ type: 'res', id, payload });
}

function eventFrame(event: string, payload: unknown): string {
  return JSON.stringify({ type: 'event', event, payload });
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dispatcherStats(dispatcher: OpenClawRequestManager): { pendingRequestCount: number; subscriberCount: number } {
  return dispatcher as unknown as { pendingRequestCount: number; subscriberCount: number };
}

class FakeWebSocketConnection implements RuntimeWebSocketConnection {
  readonly sent: Array<string | Uint8Array> = [];
  eventsCallCount = 0;
  activeEventIteratorCount = 0;
  onSend?: (data: string | Uint8Array) => void | Promise<void>;

  private readonly queue: RuntimeWebSocketEvent[] = [];
  private notify?: () => void;
  private closed = false;

  async send(data: string | Uint8Array): Promise<void> {
    this.sent.push(data);
    await this.onSend?.(data);
  }

  async *events(): AsyncIterable<RuntimeWebSocketEvent> {
    this.eventsCallCount += 1;
    this.activeEventIteratorCount += 1;
    try {
      yield { type: 'open' };
      while (!this.closed || this.queue.length > 0) {
        if (this.queue.length === 0) {
          await new Promise<void>((resolve) => {
            this.notify = resolve;
          });
          this.notify = undefined;
        }
        const event = this.queue.shift();
        if (!event) continue;
        yield event;
        if (event.type === 'close') return;
      }
    } finally {
      this.activeEventIteratorCount -= 1;
    }
  }

  async close(code?: number, reason?: string): Promise<void> {
    this.pushClose(code, reason);
  }

  pushMessage(data: string | Uint8Array): void {
    this.push({ type: 'message', data });
  }

  pushClose(code?: number, reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    this.push({ type: 'close', code, reason });
  }

  private push(event: RuntimeWebSocketEvent): void {
    this.queue.push(event);
    this.notify?.();
  }
}
