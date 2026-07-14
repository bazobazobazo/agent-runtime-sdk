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
  type RuntimeDetectionOptions,
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
      protocolVersion: '1',
      fingerprint,
      detectedAt: '2026-01-01T00:00:00.000Z',
    });

    const detector = createRuntimeDetector({ dependencies, store, probes: [createHermesProbe()] });
    expect((await detector.detect({ target })).selected?.adapterId).toBe('hermes');

    await store.set(fingerprint, {
      schemaVersion: 1,
      adapterId: 'hermes',
      runtimeProduct: 'hermes',
      protocolName: 'hermes-runs-http',
      protocolVersion: '1',
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

  it('retries authenticated OpenClaw v3 on confirmed v4 protocol mismatch using a fresh socket', async () => {
    const v4 = new FakeWebSocket([{ type: 'open' }, message({ event: 'connect.challenge', payload: { nonce: 'n4' } })]);
    const v3 = new FakeWebSocket([{ type: 'open' }, message({ event: 'connect.challenge', payload: { nonce: 'n3' } })]);
    v4.onSend = () => v4.push(message({ type: 'res', id: 'detect-connect', payload: { protocol: 3 } }));
    v3.onSend = () => v3.push(message({ type: 'res', id: 'detect-connect', payload: { protocol: 3, serverVersion: '2026.5.6', methods: ['chat.send'], events: ['chat.delta'], features: {} } }));
    const connections = [v4, v3];

    const result = await createOpenClawProbe().probe(
      { target: { endpoint: 'wss://runtime.example.test' }, auth: { kind: 'token', token: 'secret' } },
      probeContext({ webSockets: { connect: async () => connections.shift() ?? new FakeWebSocket([]) }, auth: { kind: 'token', token: 'secret' } }),
    );

    expect(result).toMatchObject({ matched: true, confidence: 0.99, protocolName: 'openclaw-gateway-v3', protocolVersion: '3' });
    expect(v4.closed).toBe(true);
    expect(v3.closed).toBe(true);
    expect(v4).not.toBe(v3);
    expect(JSON.parse(String(v4.sent[0])).params.maxProtocol).toBe(4);
    expect(JSON.parse(String(v3.sent[0])).params.maxProtocol).toBe(3);
  });

  it('does not retry OpenClaw v3 after v4 auth, pairing, or malformed hello failures', async () => {
    for (const response of [
      { error: { message: 'auth token invalid token=secret' }, code: 'AUTHENTICATION_FAILED' },
      { error: { message: 'pairing required' }, code: 'PAIRING_REQUIRED' },
      { payload: 'not-an-object', code: 'INVALID_RESPONSE' },
    ]) {
      let connects = 0;
      const connection = new FakeWebSocket([{ type: 'open' }, message({ event: 'connect.challenge', payload: { nonce: 'n' } })]);
      connection.onSend = () => connection.push(message({ type: 'res', id: 'detect-connect', ...response }));
      const result = await createOpenClawProbe().probe(
        { target: { endpoint: 'wss://runtime.example.test' }, auth: { kind: 'token', token: 'secret' } },
        probeContext({
          webSockets: {
            connect: async () => {
              connects += 1;
              return connection;
            },
          },
          auth: { kind: 'token', token: 'secret' },
        }),
      );
      expect(result.error?.code).toBe(response.code);
      expect(connects).toBe(1);
      expect(JSON.stringify(result.error)).not.toContain('secret');
    }
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

  it('does not detect generic HTTP 200, capabilities arrays, or feature objects as Hermes', async () => {
    const generic = await createHermesProbe().probe(
      { target: { endpoint: 'https://runtime.example.test' } },
      probeContext({ http: { request: async () => jsonResponse(200, { ok: true }) } }),
    );
    const models = await createHermesProbe().probe(
      { target: { endpoint: 'https://runtime.example.test' } },
      probeContext({ http: { request: async () => jsonResponse(200, { object: 'list', data: [] }) } }),
    );
    const capabilities = await createHermesProbe().probe(
      { target: { endpoint: 'https://runtime.example.test' } },
      probeContext({ http: { request: async () => jsonResponse(200, { capabilities: ['runs'], features: { run_submission: true, run_status: true } }) } }),
    );
    const features = await createHermesProbe().probe(
      { target: { endpoint: 'https://runtime.example.test' } },
      probeContext({ http: { request: async () => jsonResponse(200, { features: { run_submission: true, run_status: true } }) } }),
    );
    const malformedHermes = await createHermesProbe().probe(
      { target: { endpoint: 'https://runtime.example.test' } },
      probeContext({ http: { request: async () => jsonResponse(200, { runtime: 'hermes', features: 'yes' }) } }),
    );
    expect(generic.matched).toBe(false);
    expect(models.matched).toBe(false);
    expect(capabilities.matched).toBe(false);
    expect(features.matched).toBe(false);
    expect(malformedHermes.matched).toBe(false);
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
        probeContext({ http: { request: async () => jsonResponse(status, {}) }, auth: status === 401 ? { kind: 'token', token: 'secret' } : undefined }),
      );
      expect(result.error?.code).toBe(code);
    }
    const unauthenticated = await createHermesProbe().probe(
      { target: { endpoint: 'https://runtime.example.test' } },
      probeContext({ http: { request: async () => jsonResponse(401, { token: 'secret' }) } }),
    );
    expect(unauthenticated.error?.code).toBe('AUTHENTICATION_REQUIRED');
    expect(JSON.stringify(unauthenticated.error)).not.toContain('secret');
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
      dependencies: deps({ http: { request: async () => jsonResponse(200, { runtime: 'hermes', features: { session_resources: true, tool_progress_events: true } }) } }),
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
    const sanitized = JSON.stringify(
      sanitizeDetectionValue({
        nested: { token: 'secret', ok: true },
        errors: ['Authorization: Bearer header-secret', new Error('token=query-secret').message],
        url: 'https://runtime.example.test/path?access_token=url-secret&ok=true',
      }),
    );
    expect(sanitized).not.toContain('secret');
    await expect(new DefaultRuntimeNetworkPolicy().validateTarget(new URL('https://user:pass@runtime.example.test'))).rejects.toMatchObject({
      code: 'INVALID_CONFIGURATION',
    });
    await expect(new DefaultRuntimeNetworkPolicy().validateTarget(new URL('https://runtime.example.test?token=secret'))).rejects.toMatchObject({
      code: 'INVALID_CONFIGURATION',
    });
  });

  it('requires credential providers for credential references and keeps provider messages safe', async () => {
    const detector = createRuntimeDetector({ dependencies: deps(), probes: [] });
    await expect(detector.detect({ target: { endpoint: 'https://runtime.example.test' }, credentialRef: 'prod' })).rejects.toMatchObject({
      code: 'INVALID_CONFIGURATION',
    });

    const unresolved = createRuntimeDetector({
      dependencies: deps(),
      probes: [],
      credentials: {
        async resolve() {
          throw Object.assign(new Error('provider token=secret'), { code: 'MISSING_SECRET' });
        },
      },
    });
    await expect(unresolved.detect({ target: { endpoint: 'https://runtime.example.test' }, credentialRef: 'prod' })).rejects.toMatchObject({
      code: 'INVALID_CONFIGURATION',
      message: 'Credential reference could not be resolved',
    });

    const inlineWins = createRuntimeDetector({
      dependencies: deps(),
      probes: [createHermesProbe()],
      credentials: {
        async resolve() {
          throw new Error('should not resolve credentialRef when inline auth is present');
        },
      },
    });
    const result = await inlineWins.detect({
      target: { endpoint: 'https://runtime.example.test' },
      credentialRef: 'prod',
      auth: { kind: 'token', token: 'inline-secret' },
      options: { allowManifest: false },
    });
    expect(result.status).toBe('failed');
  });

  it('rejects cross-host redirects and unsupported schemes', async () => {
    const policy = new DefaultRuntimeNetworkPolicy();
    await expect(policy.validateTarget(new URL('ftp://runtime.example.test'))).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
    await expect(policy.validateRedirect(new URL('https://a.example.test'), new URL('https://b.example.test'))).rejects.toMatchObject({
      code: 'INVALID_CONFIGURATION',
    });
  });

  it('normalizes malformed URLs while permitting host-policy decisions for private and Unicode targets', async () => {
    const policy = new DefaultRuntimeNetworkPolicy();
    await expect(policy.validateTarget(new URL('https://[::1]:8443'))).resolves.toBeUndefined();
    await expect(policy.validateTarget(new URL('https://127.0.0.1:8443'))).resolves.toBeUndefined();
    await expect(policy.validateTarget(new URL('https://bücher.example'))).resolves.toBeUndefined();
    await expect(policy.validateTarget(new URL('https://runtime.example.test/?%74oken=secret'))).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
    await expect(createRuntimeDetector({ dependencies: deps(), probes: [] }).detect({ target: { endpoint: 'not a url' } }))
      .rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
  });

  it('rejects duplicate probe registration and leaves Codex/Pi unregistered', () => {
    expect(() => new RuntimeProbeRegistry([noMatchProbe('hermes'), noMatchProbe('hermes')])).toThrow(RuntimeError);
    expect(new RuntimeProbeRegistry([createHermesProbe(), createOpenClawProbe()]).adapterIds()).toEqual(['hermes', 'openclaw']);
  });

  it('invalidates unsupported, stale, and unregistered cached detections', async () => {
    const dependencies = deps();
    const target = { endpoint: 'https://runtime.example.test' };
    const fingerprint = await detectionFingerprint(dependencies, { target, adapterId: 'auto' });
    const base = {
      schemaVersion: 1,
      adapterId: 'hermes',
      runtimeProduct: 'hermes',
      protocolName: 'hermes-runs-http',
      protocolVersion: '1',
      fingerprint,
      detectedAt: '2026-01-01T00:00:00.000Z',
    };
    for (const cached of [
      { ...base, schemaVersion: 999 },
      { ...base, protocolVersion: '999' },
      { ...base, adapterId: 'missing' },
      { ...base, expiresAt: '2020-01-01T00:00:00.000Z' },
    ]) {
      const store = new MemoryRuntimeDetectionStore();
      const events: string[] = [];
      await store.set(fingerprint, cached);
      const detector = createRuntimeDetector({
        dependencies,
        store,
        probes: [noMatchProbe('hermes')],
        diagnostics: (event) => {
          if (event.event === 'detection.cache_invalid') events.push(String(event.status));
        },
      });
      expect((await detector.detect({ target, options: { allowManifest: false } })).status).toBe('failed');
      expect(await store.get(fingerprint)).toBeUndefined();
      expect(events).toHaveLength(1);
    }
  });

  it('aborts and cleans up underlying probes on overall timeout', async () => {
    const http = new PendingHttpTransport();
    const ws = new FakeWebSocket([{ type: 'open' }]);
    const detector = createRuntimeDetector({
      dependencies: deps({ http, webSockets: { connect: async () => ws } }),
      probes: [createHermesProbe(), createOpenClawProbe()],
    });
    await expect(detector.detect({ target: { endpoint: 'https://runtime.example.test' }, options: { allowManifest: false, overallTimeoutMs: 10, probeTimeoutMs: 1_000 } })).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
    expect(http.aborted).toBe(true);
    expect(ws.closed).toBe(true);
  });

  it('aborts per-probe HTTP requests and closes response iterators on timeout', async () => {
    const body = new BlockingBody();
    const detector = createRuntimeDetector({
      dependencies: deps({ http: { request: async () => ({ status: 200, headers: {}, body }) } }),
      probes: [createHermesProbe()],
    });
    const result = await detector.detect({ target: { endpoint: 'https://runtime.example.test' }, options: { allowManifest: false, probeTimeoutMs: 10 } });
    expect(result.status).toBe('failed');
    expect(result.candidates[0]?.error?.code).toBe('TIMEOUT');
    expect(body.returned).toBe(true);
  });

  it('closes WebSockets after per-probe timeout', async () => {
    const ws = new FakeWebSocket([{ type: 'open' }]);
    const detector = createRuntimeDetector({
      dependencies: deps({ webSockets: { connect: async () => ws } }),
      probes: [createOpenClawProbe()],
    });
    const result = await detector.detect({ target: { endpoint: 'wss://runtime.example.test' }, options: { allowManifest: false, probeTimeoutMs: 10 } });
    expect(result.status).toBe('failed');
    expect(result.candidates[0]?.error?.code).toBe('TIMEOUT');
    expect(ws.closed).toBe(true);
  });

  it('cancels detection from a caller AbortSignal and removes repeated listeners', async () => {
    const controller = new AbortController();
    const listenerCounts = trackAbortListeners(controller.signal);
    const http = new PendingHttpTransport();
    const detector = createRuntimeDetector({ dependencies: deps({ http }), probes: [createHermesProbe()] });
    const detection = detector.detect({ target: { endpoint: 'https://runtime.example.test' }, options: { allowManifest: false, signal: controller.signal } });
    await http.started;
    controller.abort(new RuntimeError({ code: 'CANCELLED', retryable: false, message: 'caller cancelled' }));
    await expect(detection).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(http.aborted).toBe(true);
    expect(listenerCounts.active()).toBe(0);

    for (let index = 0; index < 3; index += 1) {
      const perRun = new AbortController();
      const counts = trackAbortListeners(perRun.signal);
      const fast = createRuntimeDetector({ dependencies: deps(), probes: [] });
      await fast.detect({ target: { endpoint: 'https://runtime.example.test' }, options: { allowManifest: false, signal: perRun.signal } });
      expect(counts.active()).toBe(0);
    }
  });

  it('has no public allowedRedirects detection option', () => {
    const options: RuntimeDetectionOptions = { allowManifest: false };
    expect(options.allowManifest).toBe(false);
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

class PendingHttpTransport {
  aborted = false;
  started: Promise<void>;
  private markStarted!: () => void;

  constructor() {
    this.started = new Promise((resolve) => {
      this.markStarted = resolve;
    });
  }

  async request(input: { signal?: AbortSignal }): Promise<RuntimeHttpResponse> {
    this.markStarted();
    if (input.signal?.aborted) this.aborted = true;
    return new Promise((_resolve, reject) => {
      input.signal?.addEventListener(
        'abort',
        () => {
          this.aborted = true;
          reject(input.signal?.reason ?? new RuntimeError({ code: 'CANCELLED', retryable: false, message: 'aborted' }));
        },
        { once: true },
      );
    });
  }
}

class BlockingBody implements AsyncIterable<Uint8Array>, AsyncIterator<Uint8Array> {
  returned = false;
  private notify?: () => void;

  [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    return this;
  }

  async next(): Promise<IteratorResult<Uint8Array>> {
    await new Promise<void>((resolve) => {
      this.notify = resolve;
    });
    return { done: true, value: undefined };
  }

  async return(): Promise<IteratorResult<Uint8Array>> {
    this.returned = true;
    this.notify?.();
    return { done: true, value: undefined };
  }
}

function trackAbortListeners(signal: AbortSignal) {
  const originalAdd = signal.addEventListener.bind(signal);
  const originalRemove = signal.removeEventListener.bind(signal);
  const listeners = new Set<EventListenerOrEventListenerObject>();
  signal.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => {
    if (type === 'abort' && listener) listeners.add(listener);
    return originalAdd(type, listener, options);
  }) as AbortSignal['addEventListener'];
  signal.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) => {
    if (type === 'abort' && listener) listeners.delete(listener);
    return originalRemove(type, listener, options);
  }) as AbortSignal['removeEventListener'];
  return { active: () => listeners.size };
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
