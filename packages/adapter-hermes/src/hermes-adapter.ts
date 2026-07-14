import {
  RuntimeError,
  assertStartRunInput,
  connectionFingerprint,
  isTerminalEvent,
  normalizeEndpoint,
  validateInputCapabilities,
  type AgentRuntimeAdapter,
  type CancelRuntimeRunInput,
  type ConnectOptions,
  type EnsureSessionInput,
  type GetRuntimeHistoryInput,
  type GetRuntimeRunInput,
  type OperationOptions,
  type ProbeOptions,
  type ResolveRuntimeApprovalInput,
  type RuntimeAdapterDependencies,
  type RuntimeCapabilities,
  type RuntimeConnectionConfig,
  type RuntimeConnectionInfo,
  type RuntimeErrorCode,
  type RuntimeEvent,
  type RuntimeHealth,
  type RuntimeMessage,
  type RuntimeProbeResult,
  type RuntimeRunHandle,
  type RuntimeRunSnapshot,
  type RuntimeRunStatus,
  type RuntimeSession,
  type RuntimeSessionStatePatch,
  type RuntimeTarget,
  type StartRuntimeRunInput,
  type StreamRuntimeRunInput,
} from '@banzae/agent-runtime-core';
import { HermesHttpClient } from './http/client.js';
import { isHermesCapabilities, mapHermesCapabilities } from './mapping/capabilities.js';
import { mapHermesSseEvent, parseHermesEventData } from './mapping/events.js';
import { parseSseStream } from './sse/parser.js';

export type HermesSessionMode = 'auto' | 'client-scoped' | 'rest-session';

export type HermesAdapterOptions = {
  baseUrl?: string;
  bearerToken?: string;
  bearerTokenRef?: string;
  model?: string;
  requestTimeoutMs?: number;
  runTimeoutMs?: number;
  sessionMode?: HermesSessionMode;
  sessionKeyHeader?: string;
  sessionIdHeader?: string;
  historyMode?: 'previous_response_id' | 'conversation_history' | 'hybrid';
  includeRawProviderPayload?: boolean;
  maxReconnectAttempts?: number;
  reconnectDelayMs?: number;
  pollingIntervalMs?: number;
  maxReconciliationMs?: number;
};

type ConnectedHermes = {
  client: HermesHttpClient;
  capabilitiesPayload: Record<string, unknown>;
  capabilities: RuntimeCapabilities;
  descriptorFingerprint?: string;
  sessionMode: HermesSessionMode;
};

export class HermesAdapter implements AgentRuntimeAdapter {
  readonly adapterId = 'hermes';
  readonly adapterVersion = '0.1.0';

  private connected?: ConnectedHermes;
  private closed = false;

  constructor(
    private readonly deps: RuntimeAdapterDependencies,
    private readonly options: HermesAdapterOptions = {},
  ) {}

  async probe(target: RuntimeTarget, options?: ProbeOptions): Promise<RuntimeProbeResult> {
    const started = this.deps.clock.now().getTime();
    const client = new HermesHttpClient(this.deps.http, {
      baseUrl: toHttpBase(target.endpoint),
      bearerToken: options?.allowAuthentication ? authToken(target.authHint, this.options.bearerToken) : undefined,
      requestTimeoutMs: options?.timeoutMs,
    });
    try {
      const response = await client.json<unknown>('GET', '/v1/capabilities', { signal: options?.signal });
      if (!isHermesCapabilities(response.value)) {
        return { matched: false, confidence: 0.2, adapterId: this.adapterId, evidence: ['capabilities endpoint returned non-Hermes shape'], warnings: [], durationMs: elapsed(started, this.deps) };
      }
      const capabilities = asCapabilities(response.value);
      return {
        matched: true,
        confidence: 1,
        adapterId: this.adapterId,
        runtimeProduct: 'hermes-agent',
        runtimeVersion: stringValue(capabilities.version ?? capabilities.runtimeVersion),
        protocolName: 'hermes-runs-http',
        protocolVersion: '1',
        endpointFingerprint: await connectionFingerprint(this.deps.crypto, { adapterId: this.adapterId, endpoint: normalizeEndpoint(toHttpBase(target.endpoint)) }),
        capabilities: mapHermesCapabilities(capabilities),
        evidence: ['/v1/capabilities identified hermes-agent'],
        warnings: [],
        durationMs: elapsed(started, this.deps),
      };
    } catch (error) {
      return {
        matched: false,
        confidence: 0,
        adapterId: this.adapterId,
        evidence: [],
        warnings: [safeWarning(error)],
        durationMs: elapsed(started, this.deps),
      };
    } finally {
      await client.close();
    }
  }

  async connect(config: RuntimeConnectionConfig, options?: ConnectOptions): Promise<RuntimeConnectionInfo> {
    const token = await resolveBearerToken(this.deps, config, this.options);
    const client = new HermesHttpClient(this.deps.http, {
      baseUrl: this.options.baseUrl ?? toHttpBase(config.target.endpoint),
      bearerToken: token,
      requestTimeoutMs: options?.timeoutMs ?? this.options.requestTimeoutMs,
    });
    const capabilitiesPayload = asCapabilities((await client.json<unknown>('GET', '/v1/capabilities', { signal: options?.signal })).value);
    if (!isHermesCapabilities(capabilitiesPayload)) {
      throw runtimeError('DETECTION_FAILED', 'Hermes capabilities endpoint did not return a Hermes capability object', false);
    }
    const capabilities = mapHermesCapabilities(capabilitiesPayload);
    const sessionMode = selectSessionMode(this.options.sessionMode ?? 'auto', capabilities);
    this.connected = {
      client,
      capabilitiesPayload,
      capabilities,
      sessionMode,
      descriptorFingerprint: await connectionFingerprint(this.deps.crypto, {
        adapterId: this.adapterId,
        endpoint: normalizeEndpoint(this.options.baseUrl ?? toHttpBase(config.target.endpoint)),
        credentialRef: config.credentialRef ?? this.options.bearerTokenRef,
      }),
    };
    this.closed = false;
    return { descriptor: this.descriptor(this.connected), connectedAt: this.deps.clock.now().toISOString(), warnings: [] };
  }

  async health(options?: OperationOptions): Promise<RuntimeHealth> {
    const connected = this.requireConnected();
    try {
      const liveness = validateHealth((await connected.client.json<unknown>('GET', '/health', { signal: options?.signal, allowEmpty: false })).value);
      try {
        const detailed = validateDetailedHealth((await connected.client.json<unknown>('GET', '/health/detailed', { signal: options?.signal })).value);
        return { status: healthStatus(detailed.status), checkedAt: this.deps.clock.now().toISOString(), descriptor: this.descriptor(connected), warnings: [], details: { status: detailed.status, version: detailed.version } };
      } catch (error) {
        return { status: healthStatus(liveness.status), checkedAt: this.deps.clock.now().toISOString(), descriptor: this.descriptor(connected), warnings: ['detailed health unavailable'] };
      }
    } catch {
      return { status: 'unavailable', checkedAt: this.deps.clock.now().toISOString(), descriptor: this.descriptor(connected), warnings: ['Hermes liveness failed'] };
    }
  }

  async capabilities(): Promise<RuntimeCapabilities> {
    return this.requireConnected().capabilities;
  }

  async ensureSession(input: EnsureSessionInput, options?: OperationOptions): Promise<RuntimeSession> {
    const connected = this.requireConnected();
    const existing = stringValue(input.providerState?.hermesSessionId ?? input.providerState?.sessionId ?? input.providerState?.externalSessionId);
    if (existing) {
      return { applicationSessionId: input.applicationSessionId, externalSessionId: existing, providerState: { ...(input.providerState ?? {}), hermesSessionId: existing }, created: false };
    }
    if (connected.sessionMode === 'rest-session') {
      if (!connected.capabilities.sessions.create) throw unsupported('Hermes REST session creation is unavailable');
      const response = validateSessionCreateResponse(
        (await connected.client.json<unknown>('POST', '/api/sessions', {
          signal: options?.signal,
          body: { id: input.applicationSessionId, title: input.title, metadata: input.metadata },
        })).value,
      );
      return { applicationSessionId: input.applicationSessionId, externalSessionId: response.sessionId, providerState: { ...(input.providerState ?? {}), hermesSessionId: response.sessionId }, created: true };
    }
    return {
      applicationSessionId: input.applicationSessionId,
      externalSessionId: input.applicationSessionId,
      providerState: { ...(input.providerState ?? {}), hermesClientScopedSessionId: input.applicationSessionId },
      created: false,
    };
  }

  async startRun(input: StartRuntimeRunInput, options?: OperationOptions): Promise<RuntimeRunHandle> {
    assertStartRunInput(input);
    const connected = this.requireConnected();
    validateInputCapabilities(connected.capabilities, input.input);
    rejectUnsupportedAttachments(input);
    const body = buildRunBody(input, this.options);
    let response: Record<string, unknown>;
    try {
      response = validateRunCreateResponse(
        (await connected.client.json<unknown>('POST', '/v1/runs', {
          body,
          idempotencyKey: input.idempotencyKey,
          signal: options?.signal,
          timeoutMs: options?.timeoutMs ?? input.timeoutMs ?? this.options.runTimeoutMs,
          headers: sessionHeaders(input.session, this.options),
        })).value,
      );
    } catch (error) {
      if (isOutcomeUnknown(error)) throw runtimeError('OUTCOME_UNKNOWN', 'Hermes run creation outcome is unknown', true, { idempotencyKey: input.idempotencyKey });
      throw error;
    }
    const externalRunId = requiredString(response.run_id ?? response.id, 'Hermes run creation did not return a run id');
    const sessionPatch = sessionStatePatch(response);
    return {
      applicationRunId: input.applicationRunId,
      externalRunId,
      status: normalizeStatus(response.status),
      sessionStatePatch: sessionPatch,
      providerState: safeProviderState({ idempotencyKey: input.idempotencyKey, ...sessionPatch.providerState }),
    };
  }

  async *streamRun(input: StreamRuntimeRunInput, options?: OperationOptions): AsyncIterable<RuntimeEvent> {
    const connected = this.requireConnected();
    const dedupe = new Set<string>();
    let terminal = false;
    let attempts = 0;
    while (!terminal) {
      try {
        const stream = await connected.client.stream(`/v1/runs/${encodeURIComponent(input.externalRunId)}/events`, { signal: options?.signal });
        for await (const sse of parseSseStream(stream, { signal: options?.signal })) {
          const data = parseHermesEventData(sse.data);
          for (const event of mapHermesSseEvent(sse.event, data, this.eventContext(input))) {
            const key = eventDedupeKey(sse.id, event);
            if (dedupe.has(key)) continue;
            dedupe.add(key);
            yield event;
            if (isTerminalEvent(event)) terminal = true;
          }
        }
      } catch (error) {
        if (options?.signal?.aborted) throw error;
        if (attempts >= (this.options.maxReconnectAttempts ?? 1)) break;
      }
      if (terminal) break;
      const snapshot = await this.getRun(input, options);
      if (snapshot.status === 'completed') {
        yield terminalEvent(input, 'run.completed', this.deps);
        terminal = true;
      } else if (snapshot.status === 'failed') {
        yield failedTerminalEvent(input, snapshot, this.deps);
        terminal = true;
      } else if (snapshot.status === 'cancelled') {
        yield terminalEvent(input, 'run.cancelled', this.deps);
        terminal = true;
      } else if (attempts >= (this.options.maxReconnectAttempts ?? 1)) {
        yield warningEvent(input, this.deps, 'Hermes SSE stream ended before terminal event');
        break;
      } else {
        attempts += 1;
        await this.deps.clock.sleep?.(this.options.reconnectDelayMs ?? 50, options?.signal);
      }
    }
  }

  async getRun(input: GetRuntimeRunInput, options?: OperationOptions): Promise<RuntimeRunSnapshot> {
    const value = validateRunStatusResponse(
      (await this.requireConnected().client.json<unknown>('GET', `/v1/runs/${encodeURIComponent(input.externalRunId)}`, { signal: options?.signal })).value,
    );
    return {
      applicationRunId: input.applicationRunId,
      externalRunId: input.externalRunId,
      status: normalizeStatus(value.status),
      output: stringValue(value.output ?? value.text),
      usage: usage(value.usage),
      sessionStatePatch: sessionStatePatch(value),
      error: value.error ? normalizeProviderRunError(value.error) : undefined,
      providerState: safeProviderState(sessionStatePatch(value).providerState),
    };
  }

  async cancelRun(input: CancelRuntimeRunInput, options?: OperationOptions): Promise<void> {
    validateStopResponse(
      (await this.requireConnected().client.json<unknown>('POST', `/v1/runs/${encodeURIComponent(input.externalRunId)}/stop`, { signal: options?.signal })).value,
    );
  }

  async resolveApproval(input: ResolveRuntimeApprovalInput, options?: OperationOptions): Promise<void> {
    const connected = this.requireConnected();
    if (!connected.capabilities.runs.approvals) throw unsupported('Hermes approval resolution is unavailable');
    if (!input.approvalId || /[\r\n\0]/.test(input.approvalId)) throw runtimeError('INVALID_REQUEST', 'Invalid Hermes approval id', false);
    validateApprovalResponse(
      (await connected.client.json<unknown>('POST', `/v1/runs/${encodeURIComponent(input.externalRunId)}/approval`, {
        signal: options?.signal,
        body: { approval_id: input.approvalId, decision: input.decision, comment: input.comment },
      })).value,
    );
  }

  async getHistory(input: GetRuntimeHistoryInput, options?: OperationOptions): Promise<RuntimeMessage[]> {
    const connected = this.requireConnected();
    if (!connected.capabilities.sessions.history) throw unsupported('Hermes session message history is unavailable');
    const response = validateSessionMessagesResponse(
      (await connected.client.json<unknown>('GET', `/api/sessions/${encodeURIComponent(input.externalSessionId)}/messages`, { signal: options?.signal })).value,
    );
    return response.messages;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.connected?.client.close();
    this.connected = undefined;
  }

  private descriptor(connected: ConnectedHermes) {
    return {
      schemaVersion: 1 as const,
      adapterId: this.adapterId,
      adapterVersion: this.adapterVersion,
      runtimeProduct: 'hermes-agent',
      runtimeVersion: stringValue(connected.capabilitiesPayload.version ?? connected.capabilitiesPayload.runtimeVersion),
      protocolName: 'hermes-runs-http',
      protocolVersion: '1',
      endpointFingerprint: connected.descriptorFingerprint,
      capabilities: connected.capabilities,
    };
  }

  private eventContext(input: StreamRuntimeRunInput) {
    return {
      ids: this.deps.ids,
      clock: this.deps.clock,
      applicationRunId: input.applicationRunId,
      externalRunId: input.externalRunId,
      externalSessionId: input.externalSessionId,
      includeRawProviderPayload: this.options.includeRawProviderPayload,
    };
  }

  private requireConnected(): ConnectedHermes {
    if (!this.connected || this.closed) throw runtimeError('INVALID_CONFIGURATION', 'Hermes adapter is not connected', false);
    return this.connected;
  }
}

export function createHermesAdapterFactory(options?: HermesAdapterOptions) {
  return { adapterId: 'hermes', create: (dependencies: RuntimeAdapterDependencies) => new HermesAdapter(dependencies, options) };
}

function buildRunBody(input: StartRuntimeRunInput, options: HermesAdapterOptions): Record<string, unknown> {
  const providerState = input.session.providerState ?? {};
  const previousResponseId = stringValue(providerState.previousResponseId ?? providerState.hermesPreviousResponseId);
  const body: Record<string, unknown> = {
    input: input.input.text,
    session_id: input.session.externalSessionId,
    instructions: input.instructions,
    model: options.model,
  };
  if (previousResponseId && options.historyMode !== 'conversation_history') body.previous_response_id = previousResponseId;
  else if (input.history?.length) body.conversation_history = input.history.map((message) => ({ role: message.role, content: message.content }));
  return compact(body);
}

function sessionHeaders(session: RuntimeSession, options: HermesAdapterOptions): Record<string, string> {
  const headers: Record<string, string> = {};
  headers[options.sessionKeyHeader ?? 'X-Hermes-Session-Key'] = validateHeaderValue(stringValue(session.providerState?.sessionKey) ?? session.applicationSessionId, 'session key');
  headers[options.sessionIdHeader ?? 'X-Hermes-Session-Id'] = validateHeaderValue(session.externalSessionId, 'session id');
  return headers;
}

function validateHeaderValue(value: string, label: string): string {
  if (value.length > 256 || /[\u0000-\u001F\u007F]/.test(value)) throw runtimeError('INVALID_REQUEST', `Invalid Hermes ${label} header value`, false);
  return value;
}

async function resolveBearerToken(deps: RuntimeAdapterDependencies, config: RuntimeConnectionConfig, options: HermesAdapterOptions): Promise<string | undefined> {
  if (options.bearerToken) return options.bearerToken;
  if (config.auth?.kind === 'bearer' || config.auth?.kind === 'token') return config.auth.token;
  const ref = config.credentialRef ?? options.bearerTokenRef;
  if (!ref) return undefined;
  const secret = await deps.secrets.get(ref);
  if (!secret) throw runtimeError('AUTHENTICATION_REQUIRED', 'Hermes credential reference could not be resolved', false);
  return typeof secret.value === 'string' ? secret.value : new TextDecoder().decode(secret.value);
}

function selectSessionMode(mode: HermesSessionMode, capabilities: RuntimeCapabilities): HermesSessionMode {
  if (mode === 'auto') return capabilities.sessions.create && capabilities.sessions.history ? 'rest-session' : 'client-scoped';
  return mode;
}

function rejectUnsupportedAttachments(input: StartRuntimeRunInput): void {
  if (input.input.attachments?.length) throw runtimeError('UNSUPPORTED_CAPABILITY', 'Hermes Runs API adapter supports text input only', false);
}

function sessionStatePatch(value: Record<string, unknown>): RuntimeSessionStatePatch {
  const previousResponseId = stringValue(value.response_id ?? value.previous_response_id ?? value.previousResponseId);
  const externalSessionId = stringValue(value.session_id ?? value.sessionId);
  return { previousResponseId, externalSessionId, providerState: compact({ previousResponseId, hermesSessionId: externalSessionId, continuation: sanitize(value.continuation) }) };
}

function toHttpBase(endpoint: string): string {
  return endpoint.replace(/^hermes\+http:/, 'http:').replace(/^hermes\+https:/, 'https:').replace(/^agent\+https:/, 'https:');
}

function authToken(_hint: RuntimeTarget['authHint'], token: string | undefined): string | undefined {
  return token;
}

function validateRunCreateResponse(value: unknown): Record<string, unknown> {
  const record = asRecord(value, 'Hermes run creation response');
  if (!stringValue(record.run_id ?? record.id)) throw runtimeError('PROVIDER_ERROR', 'Hermes run creation did not return a run id', false);
  return record;
}

function validateRunStatusResponse(value: unknown): Record<string, unknown> {
  const record = asRecord(value, 'Hermes run status response');
  if (!stringValue(record.run_id ?? record.id)) throw runtimeError('PROVIDER_ERROR', 'Hermes run status did not return a run id', false);
  return record;
}

function validateHealth(value: unknown): Record<string, unknown> {
  return asRecord(value, 'Hermes health response');
}

function validateDetailedHealth(value: unknown): Record<string, unknown> {
  return asRecord(value, 'Hermes detailed health response');
}

function validateSessionCreateResponse(value: unknown): { sessionId: string } {
  const record = asRecord(value, 'Hermes session creation response');
  return { sessionId: requiredString(record.session_id ?? record.id, 'Hermes session creation did not return a session id') };
}

function validateSessionMessagesResponse(value: unknown): { messages: RuntimeMessage[] } {
  const record = asRecord(value, 'Hermes session message-history response');
  const values = Array.isArray(record.messages) ? record.messages : Array.isArray(record.data) ? record.data : undefined;
  if (!values) throw runtimeError('PROVIDER_ERROR', 'Hermes history response did not return messages', false);
  return { messages: values.map((message) => normalizeMessage(asRecord(message, 'Hermes message'))) };
}

function validateApprovalResponse(value: unknown): void {
  asRecord(value, 'Hermes approval response');
}

function validateStopResponse(value: unknown): void {
  asRecord(value, 'Hermes stop response');
}

function normalizeMessage(message: Record<string, unknown>): RuntimeMessage {
  const role = message.role === 'user' || message.role === 'assistant' || message.role === 'system' || message.role === 'tool' ? message.role : 'assistant';
  return { id: stringValue(message.id), role, content: stringValue(message.content ?? message.text) ?? '', createdAt: stringValue(message.created_at ?? message.createdAt) };
}

function normalizeStatus(status: unknown): RuntimeRunStatus {
  if (status === 'queued' || status === 'running' || status === 'waiting_for_approval' || status === 'stopping') return status;
  if (status === 'started') return 'running';
  if (status === 'completed' || status === 'failed' || status === 'cancelled') return status;
  return 'unknown';
}

function healthStatus(status: unknown): RuntimeHealth['status'] {
  if (status === 'ok' || status === 'healthy' || status === true) return 'healthy';
  if (status === 'degraded' || status === 'starting') return 'degraded';
  return 'unavailable';
}

function normalizeProviderRunError(value: unknown) {
  const record = asRecord(value, 'Hermes run error');
  return { code: 'PROVIDER_ERROR' as const, message: stringValue(record.code) ? `Hermes run failed: ${record.code}` : 'Hermes run failed', retryable: false };
}

function usage(value: unknown): Record<string, number> | undefined {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  if (!record) return undefined;
  const out: Record<string, number> = {};
  for (const [key, nested] of Object.entries(record)) if (typeof nested === 'number' && Number.isFinite(nested)) out[key] = nested;
  return out;
}

function asCapabilities(value: unknown): Record<string, unknown> {
  return asRecord(value, 'Hermes capabilities response');
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw runtimeError('PROVIDER_ERROR', `${label} was malformed`, false);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, message: string): string {
  const found = stringValue(value);
  if (!found) throw runtimeError('PROVIDER_ERROR', message, false);
  return found;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, nested]) => nested !== undefined));
}

function safeProviderState(value: unknown): Record<string, unknown> | undefined {
  const sanitized = sanitize(value);
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized) ? (sanitized as Record<string, unknown>) : undefined;
}

function sanitize(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return value.replace(/\b(Bearer|token|secret|password|api_key|session_key)=?[^&\s]*/gi, '$1=[redacted]');
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitize);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, /(token|secret|password|authorization|cookie|api.?key|session.?key)/i.test(key) ? '[redacted]' : sanitize(nested)]));
  return String(value);
}

function eventDedupeKey(sseId: string | undefined, event: RuntimeEvent): string {
  return sseId ?? `${event.type}:${event.externalRunId}:${event.eventId}`;
}

function terminalEvent(input: StreamRuntimeRunInput, type: 'run.completed' | 'run.cancelled', deps: RuntimeAdapterDependencies): RuntimeEvent {
  return { schemaVersion: 1, type, eventId: `${type}:${deps.ids.id()}`, occurredAt: deps.clock.now().toISOString(), applicationRunId: input.applicationRunId, externalRunId: input.externalRunId, externalSessionId: input.externalSessionId, provider: { adapterId: 'hermes' } };
}

function failedTerminalEvent(input: StreamRuntimeRunInput, snapshot: RuntimeRunSnapshot, deps: RuntimeAdapterDependencies): RuntimeEvent {
  return { schemaVersion: 1, type: 'run.failed', eventId: `run.failed:${deps.ids.id()}`, occurredAt: deps.clock.now().toISOString(), applicationRunId: input.applicationRunId, externalRunId: input.externalRunId, externalSessionId: input.externalSessionId, provider: { adapterId: 'hermes' }, error: snapshot.error ?? { code: 'PROVIDER_ERROR', message: 'Hermes run failed', retryable: false } };
}

function warningEvent(input: StreamRuntimeRunInput, deps: RuntimeAdapterDependencies, warning: string): RuntimeEvent {
  return { schemaVersion: 1, type: 'transport.warning', eventId: `transport.warning:${deps.ids.id()}`, occurredAt: deps.clock.now().toISOString(), applicationRunId: input.applicationRunId, externalRunId: input.externalRunId, externalSessionId: input.externalSessionId, provider: { adapterId: 'hermes' }, warning };
}

function isOutcomeUnknown(error: unknown): boolean {
  return error instanceof RuntimeError && (error.code === 'NETWORK' || error.code === 'TIMEOUT' || error.code === 'RUNTIME_UNAVAILABLE' || error.code === 'PROVIDER_UNAVAILABLE');
}

function unsupported(message: string): RuntimeError {
  return runtimeError('UNSUPPORTED_CAPABILITY', message, false);
}

function runtimeError(code: RuntimeErrorCode, message: string, retryable: boolean, details?: Record<string, unknown>): RuntimeError {
  return new RuntimeError({ code, message, retryable, adapterId: 'hermes', details });
}

function safeWarning(error: unknown): string {
  return error instanceof RuntimeError ? `${error.code}: ${error.message}` : 'Hermes probe failed';
}

function elapsed(started: number, deps: RuntimeAdapterDependencies): number {
  return deps.clock.now().getTime() - started;
}
