import { describe, expect, it } from 'vitest';
import {
  RuntimeError,
  createTestDependencies,
  sanitizeProviderPayload,
  type RuntimeWebSocketConnection,
  type RuntimeWebSocketEvent,
} from '@banzae/agent-runtime-core';
import { OpenClawRequestManager } from '../../adapter-openclaw/src/transport/request-manager.js';
import { openClawV4Codec } from '../../adapter-openclaw/src/protocol/v4/codec.js';
import { BoundedDedupeWindow } from '../../adapter-hermes/src/dedupe.js';
import { createRuntimeDetector } from '../../detection/src/detector.js';
import { detectionFingerprint } from '../../detection/src/security.js';
import { sanitizeLiveValue } from './live-compatibility.js';

describe('deterministic resource and performance resilience', () => {
  it('routes 10,000 sequential OpenClaw RPC responses without retained requests', async () => {
    const connection = new LoopbackConnection();
    const manager = new OpenClawRequestManager(connection, openClawV4Codec(), { requestTimeoutMs: 1_000 });
    const started = performance.now();
    for (let index = 0; index < 10_000; index += 1) {
      await expect(manager.request({ id: `request-${index}`, method: 'compatibility.echo', params: { index } })).resolves.toEqual({ index });
    }
    await manager.close();
    expect(connection.sent).toBe(10_000);
    expect(connection.openIterators).toBe(0);
    expect(performance.now() - started).toBeLessThan(20_000);
  }, 30_000);

  it('routes 1,000 concurrent reverse-order RPC responses independently', async () => {
    const connection = new ReverseConnection(1_000);
    const manager = new OpenClawRequestManager(connection, openClawV4Codec(), { requestTimeoutMs: 5_000 });
    const results = await Promise.all(Array.from({ length: 1_000 }, (_, index) =>
      manager.request<{ index: number }>({ id: `reverse-${index}`, method: 'compatibility.echo', params: { index } })));
    expect(results.map((value) => value.index)).toEqual(Array.from({ length: 1_000 }, (_, index) => index));
    await manager.close();
    expect(connection.openIterators).toBe(0);
  }, 15_000);

  it('bounds slow-subscriber queues and isolates overflow', async () => {
    const connection = new ManualConnection();
    const manager = new OpenClawRequestManager(connection, openClawV4Codec(), {
      requestTimeoutMs: 1_000,
      subscriberQueueSize: 4,
    });
    const slow = manager.subscribe()[Symbol.asyncIterator]();
    const fast = manager.subscribe()[Symbol.asyncIterator]();
    await manager.start();
    for (let index = 0; index < 5; index += 1) connection.pushMessage({ type: 'event', event: 'session.delta', payload: { index } });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await expect(slow.next()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(fast.next()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await slow.return?.();
    await fast.return?.();
    await manager.close();
    expect(connection.openIterators).toBe(0);
  });

  it('cleans 1,000 repeated aborts and remains usable', async () => {
    const connection = new LoopbackConnection();
    const manager = new OpenClawRequestManager(connection, openClawV4Codec(), { requestTimeoutMs: 1_000 });
    for (let index = 0; index < 1_000; index += 1) {
      const controller = new AbortController();
      controller.abort();
      await expect(manager.request({ id: `aborted-${index}`, method: 'compatibility.echo' }, controller.signal)).rejects.toMatchObject({ code: 'CANCELLED' });
    }
    await expect(manager.request({ id: 'after-aborts', method: 'compatibility.echo', params: { index: 1 } })).resolves.toEqual({ index: 1 });
    await manager.close();
  }, 15_000);

  it('settles a pending request exactly once when close races the response', async () => {
    const connection = new ManualConnection();
    const manager = new OpenClawRequestManager(connection, openClawV4Codec(), { requestTimeoutMs: 1_000 });
    const request = manager.request({ id: 'race', method: 'compatibility.race' });
    await Promise.resolve();
    const close = manager.close();
    connection.pushMessage({ type: 'res', id: 'race', ok: true, payload: { accepted: true } });
    await expect(request).rejects.toBeInstanceOf(RuntimeError);
    await close;
    await manager.close();
    expect(connection.openIterators).toBe(0);
  });

  it('keeps 10,000 dedupe operations within the configured window', () => {
    const dedupe = new BoundedDedupeWindow(1_024);
    const started = performance.now();
    for (let index = 0; index < 10_000; index += 1) expect(dedupe.seen(`event-${index}`)).toBe(false);
    expect(dedupe.size).toBe(1_024);
    expect(performance.now() - started).toBeLessThan(5_000);
    dedupe.clear();
    expect(dedupe.size).toBe(0);
  });

  it('maps 10,000 provider events and sanitizes 1,000 reports within guardrails', () => {
    const codec = openClawV4Codec();
    const started = performance.now();
    for (let index = 0; index < 10_000; index += 1) {
      const mapped = codec.mapProviderEvent({
        type: 'event', event: 'session.delta',
        payload: { runId: 'provider-run', sessionKey: 'provider-session', text: 'x' }, seq: index,
      }, {
        applicationRunId: 'application-run', externalRunId: 'provider-run', externalSessionId: 'provider-session',
        clock: { now: () => new Date('2026-07-14T00:00:00.000Z'), sleep: async () => undefined },
        ids: { id: () => `event-${index}` },
      });
      expect(mapped).toHaveLength(1);
    }
    for (let index = 0; index < 1_000; index += 1) {
      sanitizeLiveValue({ schemaVersion: 1, target: { endpoint: `https://runtime.example.test/${index}` }, values: Array(20).fill(index) });
    }
    expect(performance.now() - started).toBeLessThan(10_000);
  });

  it('completes 1,000 fingerprint and sanitizer operations without quadratic growth', async () => {
    const dependencies = createTestDependencies();
    const started = performance.now();
    for (let index = 0; index < 1_000; index += 1) {
      await detectionFingerprint(dependencies, { target: { endpoint: `https://runtime.example.test/${index}` } });
      sanitizeProviderPayload({ index, nested: Array.from({ length: 20 }, (_, value) => ({ value })) });
    }
    expect(performance.now() - started).toBeLessThan(10_000);
  });

  it('runs 1,000 detection cycles and isolates throwing diagnostic callbacks', async () => {
    const detector = createRuntimeDetector({
      dependencies: createTestDependencies(),
      probes: [],
      diagnostics() { throw new Error('host logger failure'); },
    });
    const started = performance.now();
    for (let index = 0; index < 1_000; index += 1) {
      const result = await detector.detect({
        target: { endpoint: `https://runtime.example.test/${index}` },
        options: { allowManifest: false, overallTimeoutMs: 1_000, probeTimeoutMs: 100 },
      });
      expect(result.status).toBe('failed');
    }
    expect(performance.now() - started).toBeLessThan(20_000);
  }, 30_000);
});

class ManualConnection implements RuntimeWebSocketConnection {
  protected readonly queue: RuntimeWebSocketEvent[] = [{ type: 'open' }];
  protected notify?: () => void;
  protected closed = false;
  openIterators = 0;
  sent = 0;

  async send(_data: string | Uint8Array): Promise<void> { this.sent += 1; }

  events(): AsyncIterable<RuntimeWebSocketEvent> {
    const owner = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<RuntimeWebSocketEvent> {
        owner.openIterators += 1;
        let returned = false;
        const finish = () => {
          if (returned) return;
          returned = true;
          owner.openIterators -= 1;
        };
        return {
          async next() {
            while (owner.queue.length === 0 && !owner.closed) await new Promise<void>((resolve) => { owner.notify = resolve; });
            const value = owner.queue.shift();
            if (!value) { finish(); return { done: true, value: undefined }; }
            if (value.type === 'close') finish();
            return { done: false, value };
          },
          async return() { finish(); return { done: true, value: undefined }; },
        };
      },
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.queue.push({ type: 'close', code: 1000, reason: 'test complete' });
    this.notify?.();
  }

  pushMessage(value: Record<string, unknown>): void {
    this.queue.push({ type: 'message', data: JSON.stringify(value) });
    this.notify?.();
  }
}

class LoopbackConnection extends ManualConnection {
  override async send(data: string | Uint8Array): Promise<void> {
    this.sent += 1;
    const request = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data)) as { id: string; params?: { index?: number } };
    this.pushMessage({ type: 'res', id: request.id, ok: true, payload: { index: request.params?.index } });
  }
}

class ReverseConnection extends ManualConnection {
  private readonly requests: Array<{ id: string; index: number }> = [];
  constructor(private readonly batchSize: number) { super(); }

  override async send(data: string | Uint8Array): Promise<void> {
    this.sent += 1;
    const request = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data)) as { id: string; params: { index: number } };
    this.requests.push({ id: request.id, index: request.params.index });
    if (this.requests.length === this.batchSize) {
      for (const current of this.requests.reverse()) this.pushMessage({ type: 'res', id: current.id, ok: true, payload: { index: current.index } });
    }
  }
}
