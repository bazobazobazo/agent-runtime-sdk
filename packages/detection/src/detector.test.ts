import { describe, expect, it } from 'vitest';
import { RuntimeError, createTestDependencies, type RuntimeHttpResponse, type RuntimeWebSocketEvent } from '@banzae/agent-runtime-core';
import {
  DefaultRuntimeNetworkPolicy,
  MemoryRuntimeDetectionStore,
  RuntimeProbeRegistry,
  createHermesProbe,
  createOpenClawProbe,
  createRuntimeDetector,
  detectionFingerprint,
  explicitAdapterId,
  normalizeTargetEndpoint,
  sanitizeDetectionValue,
  schemeHint,
  selectDetectionCandidate,
  type RuntimeProbe,
} from './index.js';

describe('runtime auto-detection', () => {
  it('explicit OpenClaw selection bypasses probes', async () => {
    const detector = createRuntimeDetector({ dependencies: deps(), probes: [failingProbe('openclaw')] });
    const result = await detector.detect({ target: { endpoint: 'https://runtime.example.test' }, adapterId: 'openclaw' });
    expect(result.status).toBe('detected');
    expect(result.selected?.adapterId).toBe('openclaw');
    expect(result.selected?.confidence).toBe(1);
  });

  it('explicit Hermes selection bypasses other probes', async () => {
    const detector = createRuntimeDetector({ dependencies: deps(), probes: [failingProbe('openclaw'), failingProbe('hermes')] });
    const result = await detector.detect({ target: { endpoint: 'https://runtime.example.test' }, adapterId: 'hermes' });
    expect(result.selected?.adapterId).toBe('hermes');
  });

  it('reuses valid cached detection and ignores stale or mismatched cache', async () => {
    const dependencies = deps();
    const store = new MemoryRuntimeDetectionStore();
    const target = { endpoint: 'https://runtime.example.test' };
    const fingerprint = await detectionFingerprint(dependencies, { target, adapterId: 'auto' });
    await store.set(fingerprint, {
      schemaVersion: 1,
      adapterId: 'hermes',
      runtimeProduct: 'hermes',
      protocolName: 'hermes-runs-http',
      fingerprint,
      detectedAt: '2026-01-01T00:00:00.000Z',
    });

    const detector = createRuntimeDetector({ dependencies, store, probes: [failingProbe('hermes')] });
    expect((await detector.detect({ target })).selected?.adapterId).toBe('hermes');

    await store.set(fingerprint, {
      schemaVersion: 1,
      adapterId: 'hermes',
      runtimeProduct: 'hermes',
      protocolName: 'hermes-runs-http',
      fingerprint: 'other',
      detectedAt: '2026-01-01T00:00:00.000Z',
    });
    expect((await detector.detect({ target })).status).toBe('failed');
  });

  it('detects connection hints but does not select hint-only below confidence threshold', () => {
    expect(explicitAdapterId({ target: { endpoint: 'x' }, adapterId: 'auto' })).toBe('auto');
    expect(schemeHint({ endpoint: 'openclaw+wss://runtime.example.test' })).toBe('openclaw');
    expect(schemeHint({ endpoint: 'hermes+https://runtime.example.test' })).toBe('hermes');
    expect(normalizeTargetEndpoint({ endpoint: 'hermes+https://runtime.example.test' }).endpoint).toBe('https://runtime.example.test');
    expect(selectDetectionCandidate([{ adapterId: 'hermes', matched: true, confidence: 0.8, evidence: [] }]).status).toBe('failed');
  });

  it('detects OpenClaw from a valid challenge without authenticated side effects', async () => {
    const connection = new FakeWebSocket([{ type: 'open' }, message({ event: 'connect.challenge', payload: { nonce: 'n' } })]);
    const result = await createOpenClawProbe().probe(
      { target: { endpoint: 'openclaw+wss://runtime.example.test' } },
      probeContext({ webSockets: { connect: async () => connection } }),
    );
    expect(result).toMatchObject({ matched: true, confidence: 0.95, adapterId: 'openclaw' });
    expect(connection.sent).toEqual([]);
    expect(connection.closed).toBe(true);
  });

  it('detects OpenClaw challenge plus hello with high confidence', async () => {
    const connection = new FakeWebSocket([{ type: 'open' }, message({ event: 'connect.challenge', payload: { nonce: 'n' } })]);
    connection.onSend = () =>
      connection.push(message({ type: 'res', id: 'detect-connect', payload: { protocol: 4, serverVersion: '2026.6.11', methods: ['chat.send'], events: ['chat.delta'], features: {} } }));
    const result = await createOpenClawProbe().probe(
      { target: { endpoint: 'wss://runtime.example.test' }, auth: { kind: 'token', token: 'secret' } },
      probeContext({ webSockets: { connect: async () => connection }, auth: { kind: 'token', token: 'secret' } }),
    );
    expect(result).toMatchObject({ matched: true, confidence: 0.99, protocolVersion: '4', runtimeVersion: '2026.6.11' });
  });

  it('does not identify generic WebSocket or malformed OpenClaw challenge', async () => {
    const result = await createOpenClawProbe().probe(
      { target: { endpoint: 'wss://runtime.example.test' } },
      probeContext({ webSockets: { connect: async () => new FakeWebSocket([{ type: 'open' }, message({ event: 'other.event', payload: {} })]) } }),
    );
    expect(result.matched).toBe(false);
  });

  it('distinguishes OpenClaw auth and pairing errors without protocol downgrade', async () => {
    const connection = new FakeWebSocket([{ type: 'open' }, message({ event: 'connect.challenge', payload: { nonce: 'n' } })]);
    connection.onSend = () => connection.push(message({ type: 'res', id: 'detect-connect', error: { message: 'pairing required' } }));
    const result = await createOpenClawProbe().probe(
      { target: { endpoint: 'wss://runtime.example.test' }, auth: { kind: 'token', token: 'secret' } },
      probeContext({ webSockets: { connect: async () => connection }, auth: { kind: 'token', token: 'secret' } }),
    );
    expect(result.error?.code).toBe('PAIRING_REQUIRED');
    expect(connection.sent).toHaveLength(1);
  });

  it('detects Hermes only from valid capabilities', async () => {
    const result = await createHermesProbe().probe(
      { target: { endpoint: 'hermes+https://runtime.example.test' } },
      probeContext({ http: { request: async () => jsonResponse(200, { runtime: 'hermes', version: '0.18.2', features: { session_resources: true, tool_progress_events: true } }) } }),
    );
    expect(result).toMatchObject({ matched: true, confidence: 0.99, adapterId: 'hermes', runtimeVersion: '0.18.2' });
  });

  it('does not detect generic HTTP 200 or models response as Hermes', async () => {
    const generic = await createHermesProbe().probe(
      { target: { endpoint: 'https://runtime.example.test' } },
      probeContext({ http: { request: async () => jsonResponse(200, { ok: true }) } }),
    );
    const models = await createHermesProbe().probe(
      { target: { endpoint: 'https://runtime.example.test' } },
      probeContext({ http: { request: async () => jsonResponse(200, { object: 'list', data: [] }) } }),
    );
    expect(generic.matched).toBe(false);
    expect(models.matched).toBe(false);
  });

  it('maps Hermes HTTP failures safely', async () => {
    for (const [status, code] of [
      [401, 'AUTHENTICATION_FAILED'],
      [403, 'AUTHORIZATION_FAILED'],
      [429, 'RATE_LIMITED'],
      [500, 'RUNTIME_UNAVAILABLE'],
    ] as const) {
      const result = await createHermesProbe().probe(
        { target: { endpoint: 'https://runtime.example.test' } },
        probeContext({ http: { request: async () => jsonResponse(status, {}) } }),
      );
      expect(result.error?.code).toBe(code);
    }
  });

  it('uses well-known manifests as evidence but safely ignores unsupported schemas', async () => {
    const hermes = createRuntimeDetector({
      dependencies: deps({ http: { request: async () => jsonResponse(200, { schemaVersion: 1, runtime: { product: 'hermes', version: '0.18.2' }, protocols: [{ name: 'hermes-runs-http', version: '1' }] }) } }),
      probes: [],
    });
    const result = await hermes.detect({ target: { endpoint: 'https://runtime.example.test' } });
    expect(result.selected?.adapterId).toBe('hermes');

    const unsupported = createRuntimeDetector({
      dependencies: deps({ http: { request: async () => jsonResponse(200, { schemaVersion: 999, runtime: { product: 'hermes' } }) } }),
      probes: [],
    });
    expect((await unsupported.detect({ target: { endpoint: 'https://runtime.example.test' } })).status).toBe('failed');
  });

  it('returns ambiguous results when high-confidence candidates are close', () => {
    expect(
      selectDetectionCandidate([
        { adapterId: 'hermes', matched: true, confidence: 0.95, evidence: [] },
        { adapterId: 'openclaw', matched: true, confidence: 0.93, evidence: [] },
      ]).status,
    ).toBe('ambiguous');
  });

  it('validated probe beats scheme hint independent of registration order', async () => {
    const detector = createRuntimeDetector({
      dependencies: deps({ http: { request: async () => jsonResponse(200, { runtime: 'hermes', features: { session_resources: true } }) } }),
      probes: [createHermesProbe(), noMatchProbe('openclaw')],
    });
    const result = await detector.detect({ target: { endpoint: 'openclaw+wss://runtime.example.test' } });
    expect(result.selected?.adapterId).toBe('hermes');
  });

  it('keeps credentials out of fingerprints, evidence, errors, and logs', async () => {
    const dependencies = deps();
    const target = { endpoint: 'https://runtime.example.test' };
    const withOne = await detectionFingerprint(dependencies, { target, credentialRef: 'prod-token' });
    const withTwo = await detectionFingerprint(dependencies, { target, credentialRef: 'prod-token' });
    expect(withOne).toBe(withTwo);
    expect(JSON.stringify(sanitizeDetectionValue({ nested: { token: 'secret', authorization: 'Bearer secret', ok: true } }))).not.toContain('secret');
    await expect(new DefaultRuntimeNetworkPolicy().validateTarget(new URL('https://user:pass@runtime.example.test'))).rejects.toMatchObject({
      code: 'INVALID_CONFIGURATION',
    });
  });

  it('rejects cross-host redirects and unsupported schemes', async () => {
    const policy = new DefaultRuntimeNetworkPolicy();
    await expect(policy.validateTarget(new URL('ftp://runtime.example.test'))).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
    await expect(policy.validateRedirect(new URL('https://a.example.test'), new URL('https://b.example.test'))).rejects.toMatchObject({
      code: 'INVALID_CONFIGURATION',
    });
  });

  it('rejects duplicate probe registration and leaves Codex/Pi unregistered', () => {
    expect(() => new RuntimeProbeRegistry([noMatchProbe('hermes'), noMatchProbe('hermes')])).toThrow(RuntimeError);
    expect(new RuntimeProbeRegistry([createHermesProbe(), createOpenClawProbe()]).adapterIds()).toEqual(['hermes', 'openclaw']);
  });
});

function failingProbe(adapterId: string): RuntimeProbe {
  return {
    adapterId,
    async probe() {
      throw new Error('probe should not run');
    },
  };
}

function noMatchProbe(adapterId: string): RuntimeProbe {
  return {
    adapterId,
    async probe() {
      return { adapterId, matched: false, confidence: 0, evidence: [] };
    },
  };
}

function probeContext(overrides: Partial<Parameters<typeof deps>[0] & { auth: any }> = {}) {
  return {
    dependencies: deps(overrides),
    auth: overrides.auth,
    probeTimeoutMs: 100,
    networkPolicy: new DefaultRuntimeNetworkPolicy(),
    emitDiagnostic() {},
  };
}

function deps(overrides: Parameters<typeof createTestDependencies>[0] = {}) {
  return createTestDependencies(overrides);
}

function message(data: unknown): RuntimeWebSocketEvent {
  return { type: 'message', data: JSON.stringify(data) };
}

function jsonResponse(status: number, body: unknown): RuntimeHttpResponse {
  return {
    status,
    headers: {},
    body: (async function* () {
      yield new TextEncoder().encode(JSON.stringify(body));
    })(),
  };
}

class FakeWebSocket {
  readonly sent: Array<string | Uint8Array> = [];
  closed = false;
  onSend?: (data: string | Uint8Array) => void;
  private readonly queue: RuntimeWebSocketEvent[];
  private notify?: () => void;

  constructor(events: RuntimeWebSocketEvent[]) {
    this.queue = [...events];
  }

  async send(data: string | Uint8Array): Promise<void> {
    this.sent.push(data);
    this.onSend?.(data);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.notify?.();
  }

  push(event: RuntimeWebSocketEvent): void {
    this.queue.push(event);
    this.notify?.();
  }

  async *events(): AsyncIterable<RuntimeWebSocketEvent> {
    while (!this.closed || this.queue.length > 0) {
      const event = this.queue.shift();
      if (event) {
        yield event;
        continue;
      }
      await new Promise<void>((resolve) => {
        this.notify = resolve;
      });
      this.notify = undefined;
    }
  }
}
