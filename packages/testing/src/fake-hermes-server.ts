import { RuntimeError, type RuntimeHttpRequest, type RuntimeHttpResponse, type RuntimeHttpTransport } from '@banzae/agent-runtime-core';

export type FakeHermesRun = {
  id: string;
  status: string;
  output?: string;
  sessionId?: string;
  responseId?: string;
  usage?: Record<string, number>;
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
      run_approval: true,
      approval_events: true,
      tool_progress_events: true,
      session_resources: true,
    },
  };
  health: Record<string, unknown> = { status: 'ok' };
  detailedHealth: Record<string, unknown> = { status: 'healthy', version: '0.18.2' };
  readonly requests: RuntimeHttpRequest[] = [];
  readonly runs = new Map<string, FakeHermesRun>();
  sessionsCreated = 0;
  failAuth = false;
  nextRunCreateNetworkFailure = false;
  eventStreamFailures = 0;

  constructor() {
    this.runs.set('run-1', {
      id: 'run-1',
      status: 'completed',
      output: 'done',
      sessionId: 'session-1',
      responseId: 'resp-1',
      usage: { input_tokens: 1, output_tokens: 2 },
      events: [
        { id: '1', event: 'run.started', data: { run_id: 'run-1', session_id: 'session-1' } },
        { id: '2', event: 'assistant.delta', data: { run_id: 'run-1', session_id: 'session-1', delta: 'hi' } },
        { id: '3', event: 'run.completed', data: { run_id: 'run-1', session_id: 'session-1' } },
      ],
    });
  }

  async request(input: RuntimeHttpRequest): Promise<RuntimeHttpResponse> {
    this.requests.push(input);
    if (input.signal?.aborted) throw input.signal.reason;
    const url = new URL(input.url);
    if (this.failAuth) return json(401, { error: 'unauthorized' });
    if (url.pathname === '/v1/capabilities') return json(200, this.capabilities);
    if (url.pathname === '/health') return json(200, this.health);
    if (url.pathname === '/health/detailed') return json(200, this.detailedHealth);
    if (url.pathname === '/api/sessions' && input.method === 'POST') {
      this.sessionsCreated += 1;
      return json(200, { session_id: `rest-session-${this.sessionsCreated}` });
    }
    const sessionMessages = url.pathname.match(/^\/api\/sessions\/([^/]+)\/messages$/);
    if (sessionMessages) return json(200, { messages: [{ id: 'm1', role: 'user', content: 'hello', created_at: '2026-01-01T00:00:00.000Z' }] });
    if (url.pathname === '/v1/runs' && input.method === 'POST') {
      if (this.nextRunCreateNetworkFailure) {
        this.nextRunCreateNetworkFailure = false;
        throw new RuntimeError({ code: 'NETWORK', retryable: true, message: 'accepted maybe' });
      }
      const body = parseBody(input.body);
      const id = `run-${this.runs.size + 1}`;
      const run: FakeHermesRun = { id, status: 'running', sessionId: stringValue(body.session_id), responseId: `resp-${id}`, events: [] };
      this.runs.set(id, run);
      return json(200, { run_id: id, status: 'running', session_id: run.sessionId, response_id: run.responseId });
    }
    const runEvents = url.pathname.match(/^\/v1\/runs\/([^/]+)\/events$/);
    if (runEvents) {
      if (this.eventStreamFailures > 0) {
        this.eventStreamFailures -= 1;
        return sse([]);
      }
      const run = this.runs.get(runEvents[1]!);
      return run ? sse(run.events ?? []) : json(404, { error: 'not found' });
    }
    const runStatus = url.pathname.match(/^\/v1\/runs\/([^/]+)$/);
    if (runStatus) {
      const run = this.runs.get(runStatus[1]!);
      return run ? json(200, { run_id: run.id, status: run.status, output: run.output, usage: run.usage, session_id: run.sessionId, response_id: run.responseId }) : json(404, { error: 'not found' });
    }
    const runStop = url.pathname.match(/^\/v1\/runs\/([^/]+)\/stop$/);
    if (runStop) {
      const run = this.runs.get(runStop[1]!);
      if (run && run.status !== 'completed') run.status = 'stopping';
      return json(200, { accepted: true, status: run?.status ?? 'unknown' });
    }
    const approval = url.pathname.match(/^\/v1\/runs\/([^/]+)\/approval$/);
    if (approval) return json(200, { accepted: true });
    return json(404, { error: 'not found' });
  }
}

function json(status: number, body: unknown): RuntimeHttpResponse {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    body: bytes(JSON.stringify(body)),
  };
}

function sse(events: Array<{ id?: string; event?: string; data: unknown }>): RuntimeHttpResponse {
  const text = events.map((event) => `${event.id ? `id: ${event.id}\n` : ''}${event.event ? `event: ${event.event}\n` : ''}data: ${JSON.stringify(event.data)}\n\n`).join('');
  return { status: 200, headers: { 'content-type': 'text/event-stream' }, body: bytes(text) };
}

async function* bytes(text: string): AsyncIterable<Uint8Array> {
  yield new TextEncoder().encode(text);
}

function parseBody(body: string | Uint8Array | undefined): Record<string, unknown> {
  if (!body) return {};
  const text = typeof body === 'string' ? body : new TextDecoder().decode(body);
  return JSON.parse(text) as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}
