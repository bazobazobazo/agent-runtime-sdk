import { RuntimeError, type RuntimeHttpRequest, type RuntimeHttpResponse, type RuntimeHttpTransport } from '@banzae/agent-runtime-core';

export type FakeHermesRun = {
  id: string;
  status: string;
  output?: string;
  sessionId?: string;
  usage?: Record<string, number>;
  error?: unknown;
  events?: Array<{ id?: string; event?: string; data: unknown }>;
};

export class FakeHermesServer implements RuntimeHttpTransport {
  capabilities: Record<string, unknown> = {
    object: 'hermes.api_server.capabilities',
    platform: 'hermes-agent',
    version: '0.18.2',
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
  };
  health: Record<string, unknown> = { status: 'ok', platform: 'hermes-agent', version: '0.18.2' };
  detailedHealth: Record<string, unknown> = { status: 'healthy', platform: 'hermes-agent', version: '0.18.2' };
  readonly requests: RuntimeHttpRequest[] = [];
  readonly runs = new Map<string, FakeHermesRun>();
  sessionsCreated = 0;
  failAuth = false;
  nextRunCreateNetworkFailure = false;
  eventStreamFailures = 0;
  streamRequests = 0;
  statusRequests = 0;
  readonly approvalBodies: Record<string, unknown>[] = [];
  approvalStatus = 200;
  approvalResponse?: unknown;
  failPermission = false;
  rateLimitRequests = 0;
  retryAfterSeconds = 1;
  malformedJsonPaths = new Set<string>();
  malformedSse = false;
  fragmentedUtf8 = false;
  wrongRunId = false;
  wrongSessionId = false;
  activeResponseBodies = 0;
  closedResponseBodies = 0;
  shutdownState = false;

  constructor() {
    this.runs.set('run-1', {
      id: 'run-1',
      status: 'completed',
      output: 'done',
      sessionId: 'session-1',
      usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
      events: [
        { id: '1', event: 'message.delta', data: { event: 'message.delta', run_id: 'run-1', delta: 'hi' } },
        { id: '2', event: 'run.completed', data: { event: 'run.completed', run_id: 'run-1', output: 'done', usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } } },
      ],
    });
  }

  async request(input: RuntimeHttpRequest): Promise<RuntimeHttpResponse> {
    this.requests.push(input);
    if (input.signal?.aborted) throw input.signal.reason;
    const url = new URL(input.url);
    if (this.shutdownState) throw new RuntimeError({ code: 'PROVIDER_UNAVAILABLE', retryable: true, message: 'Fake Hermes server is shut down' });
    if (this.failAuth) return this.responseJson(401, { error: 'unauthorized' });
    if (this.failPermission) return this.responseJson(403, { error: 'forbidden' });
    if (this.rateLimitRequests > 0) {
      this.rateLimitRequests -= 1;
      return this.responseJson(429, { error: 'rate limited' }, { 'retry-after': String(this.retryAfterSeconds) });
    }
    if (this.malformedJsonPaths.has(url.pathname)) return this.responseBytes(200, '{', 'application/json');
    if (url.pathname === '/v1/capabilities') return this.responseJson(200, this.capabilities);
    if (url.pathname === '/health') return this.responseJson(200, this.health);
    if (url.pathname === '/health/detailed') return this.responseJson(200, this.detailedHealth);
    if (url.pathname === '/api/sessions' && input.method === 'POST') {
      this.sessionsCreated += 1;
      const id = `rest-session-${this.sessionsCreated}`;
      return this.responseJson(201, { object: 'hermes.session', session: { id, source: 'api_server' } });
    }
    const session = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (session) return this.responseJson(200, { object: 'hermes.session', session: { id: session[1], source: 'api_server' } });
    const sessionMessages = url.pathname.match(/^\/api\/sessions\/([^/]+)\/messages$/);
    if (sessionMessages) return this.responseJson(200, { object: 'list', session_id: sessionMessages[1], data: [{ id: 'm1', role: 'user', content: 'hello', timestamp: '2026-01-01T00:00:00.000Z' }] });
    if (url.pathname === '/v1/runs' && input.method === 'POST') {
      if (this.nextRunCreateNetworkFailure) {
        this.nextRunCreateNetworkFailure = false;
        throw new RuntimeError({ code: 'NETWORK', retryable: true, message: 'accepted maybe' });
      }
      const body = parseBody(input.body);
      const id = `run-${this.runs.size + 1}`;
      const run: FakeHermesRun = { id, status: 'running', sessionId: stringValue(body.session_id), events: [] };
      this.runs.set(id, run);
      return this.responseJson(202, { run_id: id, status: 'started' });
    }
    const runEvents = url.pathname.match(/^\/v1\/runs\/([^/]+)\/events$/);
    if (runEvents) {
      this.streamRequests += 1;
      if (this.eventStreamFailures > 0) {
        this.eventStreamFailures -= 1;
        return this.responseSse([]);
      }
      const run = this.runs.get(runEvents[1]!);
      if (this.malformedSse) return this.responseBytes(200, 'event: message.delta\ndata: {\n\n', 'text/event-stream');
      return run ? this.responseSse((run.events ?? []).map((event) => ({ ...event, data: rewriteCorrelation(event.data, this.wrongRunId, this.wrongSessionId) }))) : this.responseJson(404, { error: 'not found' });
    }
    const runStatus = url.pathname.match(/^\/v1\/runs\/([^/]+)$/);
    if (runStatus) {
      this.statusRequests += 1;
      const run = this.runs.get(runStatus[1]!);
      return run ? this.responseJson(200, { object: 'hermes.run', run_id: run.id, status: run.status, output: run.output, usage: run.usage, error: run.error, session_id: run.sessionId }) : this.responseJson(404, { error: 'not found' });
    }
    const runStop = url.pathname.match(/^\/v1\/runs\/([^/]+)\/stop$/);
    if (runStop) {
      const run = this.runs.get(runStop[1]!);
      if (run && run.status !== 'completed') run.status = 'stopping';
      return run ? this.responseJson(200, { run_id: run.id, status: 'stopping' }) : this.responseJson(404, { error: 'not found' });
    }
    const approval = url.pathname.match(/^\/v1\/runs\/([^/]+)\/approval$/);
    if (approval) {
      const body = parseBody(input.body);
      this.approvalBodies.push(body);
      return this.responseJson(this.approvalStatus, this.approvalResponse ?? { object: 'hermes.run.approval_response', run_id: approval[1], choice: body.choice, resolved: 1 });
    }
    return this.responseJson(404, { error: 'not found' });
  }

  async shutdown(): Promise<void> {
    this.shutdownState = true;
  }

  resourceSnapshot() {
    return {
      openConnections: 0,
      pendingRequests: 0,
      activeRuns: [...this.runs.values()].filter((run) => !['completed', 'failed', 'cancelled'].includes(run.status)).length,
      activeSubscriptions: 0,
      activeResponseBodies: this.activeResponseBodies,
      listeners: 0,
    };
  }

  private responseJson(status: number, body: unknown, headers: Record<string, string> = {}): RuntimeHttpResponse {
    return this.responseBytes(status, JSON.stringify(body), 'application/json', headers);
  }

  private responseSse(events: Array<{ id?: string; event?: string; data: unknown }>): RuntimeHttpResponse {
    const text = events.map((event) => `${event.id ? `id: ${event.id}\n` : ''}${event.event ? `event: ${event.event}\n` : ''}data: ${JSON.stringify(event.data)}\n\n`).join('');
    return this.responseBytes(200, text, 'text/event-stream');
  }

  private responseBytes(status: number, text: string, contentType: string, headers: Record<string, string> = {}): RuntimeHttpResponse {
    const chunks = this.fragmentedUtf8 && text.length > 1 ? [text.slice(0, Math.ceil(text.length / 2)), text.slice(Math.ceil(text.length / 2))] : [text];
    const owner = this;
    return {
      status,
      headers: { 'content-type': contentType, ...headers },
      body: {
        [Symbol.asyncIterator]() {
          let index = 0;
          let closed = false;
          owner.activeResponseBodies += 1;
          const cleanup = () => {
            if (closed) return;
            closed = true;
            owner.activeResponseBodies = Math.max(0, owner.activeResponseBodies - 1);
            owner.closedResponseBodies += 1;
          };
          return {
            async next() {
              if (closed || index >= chunks.length) {
                cleanup();
                return { done: true, value: undefined };
              }
              const value = new TextEncoder().encode(chunks[index++]!);
              return { done: false, value };
            },
            async return() {
              cleanup();
              return { done: true, value: undefined };
            },
          };
        },
      },
    };
  }
}

function parseBody(body: string | Uint8Array | undefined): Record<string, unknown> {
  if (!body) return {};
  const text = typeof body === 'string' ? body : new TextDecoder().decode(body);
  return JSON.parse(text) as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function rewriteCorrelation(value: unknown, wrongRunId: boolean, wrongSessionId: boolean): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = { ...(value as Record<string, unknown>) };
  if (wrongRunId && typeof record.run_id === 'string') record.run_id = 'wrong-run-id';
  if (wrongSessionId && typeof record.session_id === 'string') record.session_id = 'wrong-session-id';
  return record;
}
