import {
  RuntimeError,
  type RuntimeWebSocketConnection,
  type RuntimeWebSocketEvent,
  type RuntimeWebSocketFactory,
} from '@banzae/agent-runtime-core';
import type { RuntimeConformanceResourceSnapshot, RuntimeConformanceTarget } from './contract.js';

export type FakeOpenClawFailureMode =
  | 'none'
  | 'authentication-required'
  | 'authentication-failed'
  | 'permission-denied'
  | 'pairing-required'
  | 'protocol-mismatch'
  | 'malformed-frame'
  | 'unavailable';

export type FakeOpenClawRun = {
  id: string;
  sessionKey: string;
  status: string;
  output?: string;
  sequence: number;
};

export type FakeOpenClawSchedule = Record<string, unknown> & { id: string };

export type FakeOpenClawServerOptions = {
  authToken?: string;
  failureMode?: FakeOpenClawFailureMode;
  responseDelayMs?: number;
  reverseConcurrentResponses?: boolean;
  unresolvedRuns?: boolean;
  duplicateEvents?: boolean;
  sequenceGap?: boolean;
  uncertainScheduleCreation?: boolean;
};

type RequestFrame = { type: 'req'; id: string; method: string; params?: Record<string, unknown> };

abstract class FakeOpenClawServerBase implements RuntimeWebSocketFactory {
  abstract readonly protocolVersion: 3 | 4;
  abstract readonly runtimeVersion: string;
  abstract readonly eventNamespace: 'chat' | 'session';

  readonly runs = new Map<string, FakeOpenClawRun>();
  readonly sessions = new Set<string>();
  readonly schedules = new Map<string, FakeOpenClawSchedule>();
  readonly receivedAttachments: unknown[] = [];
  readonly receivedIdempotencyKeys: string[] = [];
  readonly receivedProtocolVersions: number[] = [];
  readonly receivedMethods: string[] = [];
  openConnectionCount = 0;
  listenerCount = 0;
  pendingRequestCount = 0;
  activeSubscriptionCount = 0;
  shutdownState = false;
  providerActivity = 0;
  private runSequence = 0;
  private readonly connections = new Set<FakeOpenClawConnection>();
  private readonly delayedResponses: Array<() => void> = [];
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(readonly options: FakeOpenClawServerOptions = {}) {}

  async connect(input: { url: string; signal?: AbortSignal }): Promise<RuntimeWebSocketConnection> {
    if (this.options.failureMode === 'unavailable') {
      throw new RuntimeError({ code: 'PROVIDER_UNAVAILABLE', retryable: true, message: 'Fake OpenClaw runtime is unavailable' });
    }
    if (input.signal?.aborted) throw cancelled();
    this.shutdownState = false;
    const connection = new FakeOpenClawConnection(this);
    this.connections.add(connection);
    this.openConnectionCount += 1;
    connection.push({ type: 'open' });
    connection.pushMessage(this.challengeFrame());
    return connection;
  }

  async shutdown(): Promise<void> {
    this.shutdownState = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.pendingRequestCount = Math.max(0, this.pendingRequestCount - this.timers.size - this.delayedResponses.length);
    this.timers.clear();
    this.delayedResponses.length = 0;
    await Promise.all([...this.connections].map((connection) => connection.close(1001, 'fake server shutdown')));
  }

  resourceSnapshot(): RuntimeConformanceResourceSnapshot {
    return {
      openConnections: this.openConnectionCount,
      pendingRequests: this.pendingRequestCount,
      activeRuns: [...this.runs.values()].filter((run) => !terminalStatus(run.status)).length,
      activeSubscriptions: this.activeSubscriptionCount,
      listeners: this.listenerCount,
      timers: this.timers.size,
    };
  }

  createTarget(endpoint = `ws://openclaw-v${this.protocolVersion}.example.test`): RuntimeConformanceTarget {
    return {
      connection: {
        target: { endpoint, transportHint: 'websocket' },
        auth: this.options.authToken ? { kind: 'token', token: this.options.authToken } : { kind: 'none' },
        options: { protocolVersions: [this.protocolVersion] },
      },
      resourceSnapshot: () => this.resourceSnapshot(),
      providerActivityCount: () => this.providerActivity,
      receivedIdempotencyKeys: () => this.receivedIdempotencyKeys,
    };
  }

  emitRunSuccess(runId: string, options: { duplicate?: boolean; gap?: boolean } = {}): void {
    const run = this.requireRun(runId);
    const gap = options.gap ?? this.options.sequenceGap;
    const duplicate = options.duplicate ?? this.options.duplicateEvents;
    const firstSequence = gap ? 2 : 1;
    this.broadcast(this.eventFrame(this.deltaEventName(), {
      eventId: `${run.id}:delta`,
      runId: run.id,
      sessionKey: run.sessionKey,
      sequence: firstSequence,
      text: 'hello from fake OpenClaw',
    }));
    if (duplicate) {
      this.broadcast(this.eventFrame(this.deltaEventName(), {
        eventId: `${run.id}:delta`, runId: run.id, sessionKey: run.sessionKey, sequence: firstSequence, text: 'hello from fake OpenClaw',
      }));
    }
    run.sequence = firstSequence + 1;
    run.status = 'completed';
    run.output = 'hello from fake OpenClaw';
    const completed = this.eventFrame(this.completedEventName(), {
      eventId: `${run.id}:completed`, runId: run.id, sessionKey: run.sessionKey, sequence: run.sequence, text: run.output,
    });
    this.broadcast(completed);
    if (duplicate) this.broadcast(completed);
  }

  emitRunFailure(runId: string): void {
    const run = this.requireRun(runId);
    run.status = 'failed';
    this.broadcast(this.eventFrame('chat.failed', { eventId: `${run.id}:failed`, runId: run.id, sessionKey: run.sessionKey, sequence: ++run.sequence, error: 'synthetic failure' }));
  }

  emitUnrelatedEvent(): void {
    this.broadcast(this.eventFrame('gateway.status', { status: 'ok' }));
  }

  interruptSockets(): void {
    for (const connection of this.connections) connection.push({ type: 'close', code: 1006, reason: 'synthetic interruption' });
  }

  connectionClosed(connection: FakeOpenClawConnection): void {
    if (!this.connections.delete(connection)) return;
    this.openConnectionCount -= 1;
  }

  iteratorOpened(): void {
    this.listenerCount += 1;
    this.activeSubscriptionCount += 1;
  }

  iteratorClosed(): void {
    this.listenerCount = Math.max(0, this.listenerCount - 1);
    this.activeSubscriptionCount = Math.max(0, this.activeSubscriptionCount - 1);
  }

  async receive(connection: FakeOpenClawConnection, data: string | Uint8Array): Promise<void> {
    this.providerActivity += 1;
    let request: RequestFrame;
    try {
      request = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data)) as RequestFrame;
    } catch {
      connection.pushMessage('{');
      return;
    }
    this.receivedMethods.push(request.method);
    this.pendingRequestCount += 1;
    const respond = () => {
      try {
        this.handleRequest(connection, request);
      } finally {
        this.pendingRequestCount -= 1;
      }
    };
    if (this.options.reverseConcurrentResponses && request.method !== 'connect') {
      this.delayedResponses.push(respond);
      if (this.delayedResponses.length >= 2) {
        const values = this.delayedResponses.splice(0).reverse();
        for (const value of values) value();
      }
      return;
    }
    if ((this.options.responseDelayMs ?? 0) > 0) {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        respond();
      }, this.options.responseDelayMs);
      this.timers.add(timer);
    } else queueMicrotask(respond);
  }

  protected abstract challengeFrame(): Record<string, unknown>;
  protected abstract helloPayload(): Record<string, unknown>;
  protected abstract deltaEventName(): string;
  protected abstract completedEventName(): string;

  private handleRequest(connection: FakeOpenClawConnection, request: RequestFrame): void {
    if (this.options.failureMode === 'malformed-frame') {
      connection.pushMessage('{');
      return;
    }
    if (request.method === 'connect') {
      const params = request.params ?? {};
      this.receivedProtocolVersions.push(numberValue(params.maxProtocol) ?? -1);
      const failure = this.connectFailure(params);
      if (failure) connection.pushMessage({ type: 'res', id: request.id, error: failure });
      else connection.pushMessage({ type: 'res', id: request.id, ok: true, payload: this.helloPayload() });
      return;
    }
    if (request.method === 'sessions.create') {
      const key = stringValue(request.params?.key) ?? `session-${this.sessions.size + 1}`;
      this.sessions.add(key);
      connection.pushMessage({ type: 'res', id: request.id, ok: true, payload: { sessionKey: key, created: true } });
      return;
    }
    if (request.method === 'chat.send') {
      const runId = `openclaw-v${this.protocolVersion}-run-${++this.runSequence}`;
      const sessionKey = stringValue(request.params?.sessionKey) ?? 'session-unknown';
      const idempotencyKey = stringValue(request.params?.idempotencyKey);
      if (idempotencyKey) this.receivedIdempotencyKeys.push(idempotencyKey);
      if (Array.isArray(request.params?.attachments)) this.receivedAttachments.push(...request.params.attachments);
      this.runs.set(runId, { id: runId, sessionKey, status: 'running', sequence: 0 });
      connection.pushMessage({ type: 'res', id: request.id, ok: true, payload: this.runStartPayload(runId) });
      return;
    }
    if (request.method === 'agent.wait') {
      const runId = stringValue(request.params?.runId) ?? '';
      const run = this.runs.get(runId);
      connection.pushMessage(run
        ? { type: 'res', id: request.id, ok: true, payload: { runId, status: run.status, output: run.output } }
        : { type: 'res', id: request.id, error: { code: 'NOT_FOUND', message: 'run not found' } });
      return;
    }
    if (request.method === 'chat.history') {
      connection.pushMessage({ type: 'res', id: request.id, ok: true, payload: this.historyPayload() });
      return;
    }
    if (request.method === 'chat.abort') {
      const runId = stringValue(request.params?.runId) ?? '';
      const run = this.runs.get(runId);
      if (run && !terminalStatus(run.status)) run.status = 'cancelled';
      connection.pushMessage({ type: 'res', id: request.id, ok: true, payload: this.cancelPayload(runId) });
      return;
    }
    if (request.method === 'cron.add') {
      const job = this.protocolVersion >= 4 ? recordValue(request.params) : recordValue(request.params?.job);
      const metadata = recordValue(job.metadata);
      const idempotencyKey = this.protocolVersion >= 4 ? undefined : stringValue(request.params?.idempotencyKey) ?? stringValue(metadata.idempotencyKey);
      const existing = idempotencyKey ? [...this.schedules.values()].find((item) => stringValue(item.declarationKey) === idempotencyKey || stringValue(item.idempotencyKey) === idempotencyKey || stringValue(recordValue(item.metadata).idempotencyKey) === idempotencyKey) : undefined;
      const schedule = existing ?? { ...job, ...(this.protocolVersion >= 4 ? { declarationKey: idempotencyKey } : { idempotencyKey }), id: `openclaw-v${this.protocolVersion}-schedule-${this.schedules.size + 1}`, enabled: job.enabled !== false };
      this.schedules.set(schedule.id, schedule);
      if (this.options.uncertainScheduleCreation) {
        this.options.uncertainScheduleCreation = false;
        connection.pushMessage({ type: 'res', id: request.id, error: { code: 'TIMEOUT', message: 'synthetic acceptance timeout' } });
        return;
      }
      connection.pushMessage({ type: 'res', id: request.id, ok: true, payload: { jobId: schedule.id, job: schedule } });
      return;
    }
    if (request.method === 'cron.list') {
      connection.pushMessage({ type: 'res', id: request.id, ok: true, payload: { jobs: [...this.schedules.values()] } });
      return;
    }
    if (request.method === 'cron.get') {
      const jobId = stringValue(request.params?.jobId) ?? '';
      const job = this.schedules.get(jobId);
      connection.pushMessage(job ? { type: 'res', id: request.id, ok: true, payload: { jobId, job } } : { type: 'res', id: request.id, error: { code: 'NOT_FOUND', message: 'schedule not found' } });
      return;
    }
    if (request.method === 'cron.update') {
      const jobId = stringValue(request.params?.jobId) ?? '';
      const current = this.schedules.get(jobId);
      if (!current) connection.pushMessage({ type: 'res', id: request.id, error: { code: 'NOT_FOUND', message: 'schedule not found' } });
      else {
        const updated = { ...current, ...recordValue(request.params?.patch), id: jobId };
        this.schedules.set(jobId, updated);
        connection.pushMessage({ type: 'res', id: request.id, ok: true, payload: { jobId, job: updated } });
      }
      return;
    }
    if (request.method === 'cron.remove') {
      const jobId = stringValue(request.params?.jobId ?? request.params?.id) ?? '';
      this.schedules.delete(jobId);
      connection.pushMessage({ type: 'res', id: request.id, ok: true, payload: { removed: true, jobId } });
      return;
    }
    if (request.method === 'cron.run') {
      const jobId = stringValue(request.params?.jobId) ?? '';
      connection.pushMessage({ type: 'res', id: request.id, ok: true, payload: { jobId, runId: `${jobId}-execution-1`, status: 'completed', completedAt: '2026-07-17T00:00:00.000Z' } });
      return;
    }
    if (request.method === 'cron.runs') {
      const jobId = stringValue(request.params?.jobId) ?? '';
      connection.pushMessage({ type: 'res', id: request.id, ok: true, payload: { entries: [{ jobId, runId: `${jobId}-execution-1`, status: 'completed', completedAt: '2026-07-17T00:00:00.000Z' }] } });
      return;
    }
    connection.pushMessage({ type: 'res', id: request.id, error: { code: 'INVALID_REQUEST', message: 'unsupported fake method' } });
  }

  protected runStartPayload(runId: string): Record<string, unknown> {
    return { runId, status: 'running' };
  }

  protected historyPayload(): Record<string, unknown> {
    return { messages: [{ id: `v${this.protocolVersion}-message-1`, role: 'assistant', content: [{ text: `OpenClaw v${this.protocolVersion} history` }] }] };
  }

  protected cancelPayload(runId: string): Record<string, unknown> {
    return { accepted: true, runId };
  }

  private connectFailure(params: Record<string, unknown>): Record<string, unknown> | undefined {
    if (this.options.failureMode === 'protocol-mismatch' || numberValue(params.maxProtocol) !== this.protocolVersion) {
      return { code: 'INVALID_REQUEST', message: 'protocol mismatch', details: { expectedProtocol: this.protocolVersion } };
    }
    if (this.options.failureMode === 'pairing-required') {
      return { code: 'NOT_PAIRED', message: 'pairing required', details: { code: 'PAIRING_REQUIRED', requestId: 'fake-pairing-request' } };
    }
    if (this.options.failureMode === 'permission-denied') return { code: 'PERMISSION_DENIED', message: 'permission denied' };
    const auth = recordValue(params.auth);
    if (this.options.failureMode === 'authentication-required' && !auth.token) return { code: 'AUTHENTICATION_FAILED', message: 'authentication required' };
    if (this.options.failureMode === 'authentication-failed' || (this.options.authToken && auth.token !== this.options.authToken)) {
      return { code: 'AUTHENTICATION_FAILED', message: 'authentication failed' };
    }
    return undefined;
  }

  private eventFrame(event: string, payload: Record<string, unknown>): Record<string, unknown> {
    return { type: 'event', event, payload };
  }

  private broadcast(frame: Record<string, unknown>): void {
    for (const connection of this.connections) connection.pushMessage(frame);
  }

  private requireRun(runId: string): FakeOpenClawRun {
    const run = this.runs.get(runId);
    if (!run) throw new RuntimeError({ code: 'NOT_FOUND', retryable: false, message: 'Fake OpenClaw run not found' });
    return run;
  }
}

/** Testing-only protocol v3 Gateway. Its v3 frame builders are independent. */
export class FakeOpenClawV3Server extends FakeOpenClawServerBase {
  readonly protocolVersion = 3 as const;
  readonly runtimeVersion = '2026.4.22';
  readonly eventNamespace = 'chat' as const;

  protected challengeFrame(): Record<string, unknown> {
    return { event: 'connect.challenge', payload: { nonce: 'fake-v3-nonce' } };
  }

  protected helloPayload(): Record<string, unknown> {
    return {
      protocol: 3,
      serverVersion: this.runtimeVersion,
      connectionId: 'fake-v3-connection',
      methods: ['sessions.create', 'chat.send', 'agent.wait', 'chat.history', 'chat.abort', 'cron.add', 'cron.get', 'cron.list', 'cron.update', 'cron.remove', 'cron.run', 'cron.runs'],
      events: ['connect.challenge', 'chat.delta', 'chat.completed', 'chat.failed', 'chat.cancelled'],
      features: { wireGeneration: 'v3' },
    };
  }

  protected deltaEventName(): string { return 'chat.delta'; }
  protected completedEventName(): string { return 'chat.completed'; }
}

/** Testing-only protocol v4 Gateway with v4-specific session event fixtures. */
export class FakeOpenClawV4Server extends FakeOpenClawServerBase {
  readonly protocolVersion = 4 as const;
  readonly runtimeVersion = '2026.6.11';
  readonly eventNamespace = 'session' as const;

  protected challengeFrame(): Record<string, unknown> {
    return { type: 'event', event: 'connect.challenge', payload: { nonce: 'fake-v4-nonce', challengeVersion: 2 } };
  }

  protected helloPayload(): Record<string, unknown> {
    return {
      protocolVersion: 4,
      version: this.runtimeVersion,
      server: { connId: 'fake-v4-connection', version: this.runtimeVersion },
      methods: ['sessions.create', 'chat.send', 'agent.wait', 'chat.history', 'chat.abort', 'cron.add', 'cron.get', 'cron.list', 'cron.update', 'cron.remove', 'cron.run', 'cron.runs'],
      events: ['connect.challenge', 'session.delta', 'session.completed', 'session.failed', 'session.cancelled'],
      features: { methods: ['sessions.create', 'chat.send', 'agent.wait', 'chat.history', 'chat.abort', 'cron.add', 'cron.get', 'cron.list', 'cron.update', 'cron.remove', 'cron.run', 'cron.runs'], events: ['session.delta', 'session.completed'], wireGeneration: 'v4' },
    };
  }

  protected deltaEventName(): string { return 'session.delta'; }
  protected completedEventName(): string { return 'session.completed'; }

  protected override runStartPayload(runId: string): Record<string, unknown> {
    return { id: runId, status: 'started', protocol: 4 };
  }

  protected override historyPayload(): Record<string, unknown> {
    return { messages: [{ id: 'v4-message-1', role: 'assistant', content: [{ type: 'text', text: 'OpenClaw v4 history' }], sequence: 1 }] };
  }

  protected override cancelPayload(runId: string): Record<string, unknown> {
    return { accepted: true, runId, state: 'cancelling' };
  }
}

class FakeOpenClawConnection implements RuntimeWebSocketConnection {
  private readonly queue: RuntimeWebSocketEvent[] = [];
  private notify?: () => void;
  private closed = false;
  private iteratorActive = false;

  constructor(private readonly server: FakeOpenClawServerBase) {}

  async send(data: string | Uint8Array): Promise<void> {
    if (this.closed) throw new RuntimeError({ code: 'NETWORK', retryable: true, message: 'Fake OpenClaw socket is closed' });
    await this.server.receive(this, data);
  }

  events(): AsyncIterable<RuntimeWebSocketEvent> {
    const owner = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<RuntimeWebSocketEvent> {
        if (owner.iteratorActive) throw new RuntimeError({ code: 'CONFLICT', retryable: false, message: 'Fake socket supports one event iterator' });
        owner.iteratorActive = true;
        owner.server.iteratorOpened();
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          owner.iteratorActive = false;
          owner.server.iteratorClosed();
        };
        return {
          async next() {
            while (owner.queue.length === 0 && !owner.closed) await new Promise<void>((resolve) => { owner.notify = resolve; });
            const value = owner.queue.shift();
            if (!value) {
              finish();
              return { done: true, value: undefined };
            }
            if (value.type === 'close') finish();
            return { done: false, value };
          },
          async return() {
            finish();
            return { done: true, value: undefined };
          },
        };
      },
    };
  }

  async close(code = 1000, reason = 'closed'): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.push({ type: 'close', code, reason });
    this.notify?.();
    this.server.connectionClosed(this);
  }

  push(event: RuntimeWebSocketEvent): void {
    this.queue.push(event);
    this.notify?.();
  }

  pushMessage(value: string | Record<string, unknown>): void {
    this.push({ type: 'message', data: typeof value === 'string' ? value : JSON.stringify(value) });
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function terminalStatus(status: string): boolean {
  return ['completed', 'failed', 'cancelled', 'canceled'].includes(status);
}

function cancelled(): RuntimeError {
  return new RuntimeError({ code: 'CANCELLED', retryable: false, message: 'Fake OpenClaw connection cancelled' });
}
