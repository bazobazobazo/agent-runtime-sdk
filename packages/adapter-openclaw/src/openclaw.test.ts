import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { RuntimeError, type RuntimeWebSocketConnection, type RuntimeWebSocketEvent } from '@banzae/agent-runtime-core';
import { OpenClawProtocolRegistry, OpenClawRequestManager, openClawV3Codec, openClawV4Codec } from './index.js';
import { normalizeOpenClawHistory } from './mapping/transcript.js';

describe('OpenClaw protocol scaffolding', () => {
  it('orders codecs newest first', () => {
    const registry = new OpenClawProtocolRegistry();
    registry.register(openClawV3Codec());
    registry.register(openClawV4Codec());
    expect(registry.preferredVersions()).toEqual([4, 3]);
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
    expect(mapped.message).toBe('protocol mismatch');
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
    expect(mapped.message).toContain('pairing required');
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

    await expect(request).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
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
