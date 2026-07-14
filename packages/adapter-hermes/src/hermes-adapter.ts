import {
  RuntimeError,
  assertStartRunInput,
  connectionFingerprint,
  isTerminalEvent,
  normalizeEndpoint,
  resolveSecureLimit,
  SECURE_RUNTIME_LIMITS,
  sanitizeProviderPayload,
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
  type RuntimeApprovalDecision,
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
  type RuntimeSession,
  type RuntimeSessionStatePatch,
  type RuntimeTarget,
  type StartRuntimeRunInput,
  type StreamRuntimeRunInput,
} from '@banzae/agent-runtime-core';
import { BoundedDedupeWindow } from './dedupe.js';
import { HermesHttpClient } from './http/client.js';
import { isHermesCapabilities, mapHermesCapabilities, validateHermesCapabilities } from './mapping/capabilities.js';
import { mapHermesSseEvent, parseHermesEventData, toHermesChoice } from './mapping/events.js';
import {
  normalizeStatus,
  validateApprovalResponse,
  validateDetailedHealth,
  validateHealth,
  validateRunCreateResponse,
  validateRunStatusResponse,
  validateSessionCreateResponse,
  validateSessionMessagesResponse,
  validateStopResponse,
  type HermesApprovalChoice,
} from './schemas.js';
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
  maxDeduplicationEntries?: number;
};

type ConnectedHermes = {
  client: HermesHttpClient;
  capabilitiesPayload: Record<string, unknown>;
  capabilities: RuntimeCapabilities;
  descriptorFingerprint?: string;
  sessionMode: HermesSessionMode;
};

type StreamOperation = {
  controller: AbortController;
  signal: AbortSignal;
  done: Promise<void>;
  finish: () => void;
  cleanup: () => void;
  stop: (reason: RuntimeError) => Promise<void>;
};

type ApprovalState = {
  externalRunId: string;
  choices: Set<HermesApprovalChoice>;
  resolving: boolean;
};

const DEFAULT_RECONNECT_DELAY_MS = 250;
const DEFAULT_POLLING_INTERVAL_MS = 1_000;

export class HermesAdapter implements AgentRuntimeAdapter {
  readonly adapterId = 'hermes';
  readonly adapterVersion = '0.1.0';

  private connected?: ConnectedHermes;
  private closed = false;
  private closing?: Promise<void>;
  private readonly activeStreams = new Set<StreamOperation>();
  private readonly approvals = new Map<string, ApprovalState>();

  constructor(
    private readonly deps: RuntimeAdapterDependencies,
    private readonly options: HermesAdapterOptions = {},
  ) {
    resolveSecureLimit('maxReconnectAttempts', options.maxReconnectAttempts, { allowZero: true });
    resolveSecureLimit('maxReconciliationMs', options.maxReconciliationMs);
    resolveSecureLimit('maxDeduplicationEntries', options.maxDeduplicationEntries);
    positiveInteger(options.reconnectDelayMs, 'reconnectDelayMs', true, 300_000);
    positiveInteger(options.pollingIntervalMs, 'pollingIntervalMs', false, 300_000);
    positiveInteger(options.requestTimeoutMs, 'requestTimeoutMs', false, 300_000);
    positiveInteger(options.runTimeoutMs, 'runTimeoutMs', false, 300_000);
  }

  async probe(target: RuntimeTarget, options?: ProbeOptions): Promise<RuntimeProbeResult> {
    const started = this.deps.clock.now().getTime();
    const client = new HermesHttpClient(this.deps.http, {
      baseUrl: toHttpBase(target.endpoint),
      bearerToken: options?.allowAuthentication ? this.options.bearerToken : undefined,
      requestTimeoutMs: options?.timeoutMs,
    });
    try {
      const response = await client.json<unknown>('GET', '/v1/capabilities', { signal: options?.signal });
      if (!isHermesCapabilities(response.value)) {
        return { matched: false, confidence: 0.2, adapterId: this.adapterId, evidence: ['capabilities endpoint returned non-Hermes shape'], warnings: [], durationMs: elapsed(started, this.deps) };
      }
      const validated = validateHermesCapabilities(response.value);
      return {
        matched: true,
        confidence: 1,
        adapterId: this.adapterId,
        runtimeProduct: 'hermes-agent',
        runtimeVersion: runtimeVersion(validated.value),
        protocolName: 'hermes-runs-http',
        protocolVersion: '1',
        endpointFingerprint: await connectionFingerprint(this.deps.crypto, { adapterId: this.adapterId, endpoint: normalizeEndpoint(toHttpBase(target.endpoint)) }),
        capabilities: mapHermesCapabilities(validated.value),
        evidence: ['/v1/capabilities identified hermes-agent'],
        warnings: [],
        durationMs: elapsed(started, this.deps),
      };
    } catch (error) {
      return { matched: false, confidence: 0, adapterId: this.adapterId, evidence: [], warnings: [safeWarning(error)], durationMs: elapsed(started, this.deps) };
    } finally {
      await client.close();
    }
  }

  async connect(config: RuntimeConnectionConfig, options?: ConnectOptions): Promise<RuntimeConnectionInfo> {
    if (this.activeStreams.size > 0) throw runtimeError('INVALID_CONFIGURATION', 'Hermes cannot reconnect while streams are active', false);
    const token = await resolveBearerToken(this.deps, config, this.options);
    const client = new HermesHttpClient(this.deps.http, {
      baseUrl: this.options.baseUrl ?? toHttpBase(config.target.endpoint),
      bearerToken: token,
      requestTimeoutMs: options?.timeoutMs ?? this.options.requestTimeoutMs,
    });
    const previous = this.connected;
    this.connected = undefined;
    await previous?.client.close();
    try {
      const response = await client.json<unknown>('GET', '/v1/capabilities', { signal: options?.signal });
      const validated = validateHermesCapabilities(response.value);
      const capabilities = mapHermesCapabilities(validated.value);
      const sessionMode = selectSessionMode(this.options.sessionMode ?? 'auto', capabilities);
      const next: ConnectedHermes = {
        client,
        capabilitiesPayload: validated.value,
        capabilities,
        sessionMode,
        descriptorFingerprint: await connectionFingerprint(this.deps.crypto, {
          adapterId: this.adapterId,
          endpoint: normalizeEndpoint(this.options.baseUrl ?? toHttpBase(config.target.endpoint)),
        }),
      };
      this.connected = next;
      this.closed = false;
      return { descriptor: this.descriptor(next), connectedAt: this.deps.clock.now().toISOString(), warnings: [] };
    } catch (error) {
      await client.close();
      throw normalizeAdapterError(error, 'connect');
    }
  }

  async health(options?: OperationOptions): Promise<RuntimeHealth> {
    const connected = this.requireConnected();
    try {
      const liveness = validateHealth((await connected.client.json<unknown>('GET', '/health', { signal: options?.signal })).value);
      try {
        const detailed = validateDetailedHealth((await connected.client.json<unknown>('GET', '/health/detailed', { signal: options?.signal })).value);
        return { status: healthStatus(detailed.status), checkedAt: this.deps.clock.now().toISOString(), descriptor: this.descriptor(connected), warnings: [], details: { status: detailed.status, version: detailed.version } };
      } catch (error) {
        if (shouldRethrowHealthError(error)) throw error;
        return { status: healthStatus(liveness.status), checkedAt: this.deps.clock.now().toISOString(), descriptor: this.descriptor(connected), warnings: ['detailed health unavailable'] };
      }
    } catch (error) {
      if (shouldRethrowHealthError(error)) throw error;
      return { status: 'unavailable', checkedAt: this.deps.clock.now().toISOString(), descriptor: this.descriptor(connected), warnings: ['Hermes liveness failed'] };
    }
  }

  async capabilities(): Promise<RuntimeCapabilities> {
    return this.requireConnected().capabilities;
  }

  async ensureSession(input: EnsureSessionInput, options?: OperationOptions): Promise<RuntimeSession> {
    const connected = this.requireConnected();
    const existing = safeIdentifier(input.providerState?.hermesSessionId ?? input.providerState?.externalSessionId);
    if (existing) return { applicationSessionId: input.applicationSessionId, externalSessionId: existing, providerState: { ...(input.providerState ?? {}), hermesSessionId: existing }, created: false };
    if (connected.sessionMode === 'rest-session') {
      if (!connected.capabilities.sessions.create || !connected.capabilities.sessions.history) throw unsupported('Hermes REST sessions are unavailable');
      const response = validateSessionCreateResponse((await connected.client.json<unknown>('POST', '/api/sessions', {
        signal: options?.signal,
        body: { id: input.applicationSessionId, title: input.title },
      })).value);
      return { applicationSessionId: input.applicationSessionId, externalSessionId: response.sessionId, providerState: { ...(input.providerState ?? {}), hermesSessionId: response.sessionId }, created: true };
    }
    const applicationSessionId = validateHeaderValue(input.applicationSessionId, 'application session id');
    return { applicationSessionId, externalSessionId: applicationSessionId, providerState: { ...(input.providerState ?? {}), hermesClientScopedSessionId: applicationSessionId }, created: false };
  }

  async startRun(input: StartRuntimeRunInput, options?: OperationOptions): Promise<RuntimeRunHandle> {
    assertStartRunInput(input);
    const connected = this.requireConnected();
    if (!connected.capabilities.runs.start) throw unsupported('Hermes run submission is unavailable');
    validateInputCapabilities(connected.capabilities, input.input);
    rejectUnsupportedAttachments(input);
    let response;
    try {
      response = validateRunCreateResponse((await connected.client.json<unknown>('POST', '/v1/runs', {
        body: buildRunBody(input, this.options),
        idempotencyKey: input.idempotencyKey,
        signal: options?.signal,
        timeoutMs: options?.timeoutMs ?? input.timeoutMs ?? this.options.runTimeoutMs,
        headers: sessionHeaders(input.session, this.options, connected.capabilities),
      })).value);
    } catch (error) {
      if (isOutcomeUnknown(error)) throw runtimeError('OUTCOME_UNKNOWN', 'Hermes run creation outcome is unknown', true, { idempotencyKey: input.idempotencyKey });
      throw error;
    }
    return {
      applicationRunId: input.applicationRunId,
      externalRunId: response.runId,
      status: normalizeStatus(response.status),
      sessionStatePatch: sessionStatePatch({ session_id: input.session.externalSessionId }),
      providerState: safeProviderState({ idempotencyKey: input.idempotencyKey, hermesSessionId: input.session.externalSessionId }),
    };
  }

  streamRun(input: StreamRuntimeRunInput, options?: OperationOptions): AsyncIterable<RuntimeEvent> {
    const connected = this.requireConnected();
    if (!connected.capabilities.runs.streamText) throw unsupported('Hermes run event streaming is unavailable');
    const operation = createStreamOperation(options?.signal, options?.timeoutMs);
    const inner = this.iterateRunStream(connected, input, options, operation)[Symbol.asyncIterator]();
    const tracked = trackStream(inner, operation, () => this.activeStreams.delete(operation));
    this.activeStreams.add(operation);
    return tracked;
  }

  private async *iterateRunStream(
    connected: ConnectedHermes,
    input: StreamRuntimeRunInput,
    options: OperationOptions | undefined,
    operation: StreamOperation,
  ): AsyncIterable<RuntimeEvent> {
    const dedupe = new BoundedDedupeWindow(this.options.maxDeduplicationEntries ?? SECURE_RUNTIME_LIMITS.maxDeduplicationEntries);
    const pendingApprovalIds: string[] = [];
    const pendingToolIds = new Map<string, string[]>();
    const startedAt = this.deps.clock.now().getTime();
    const maxReconciliationMs = this.options.maxReconciliationMs ?? SECURE_RUNTIME_LIMITS.maxReconciliationMs;
    const deadlineAt = startedAt + maxReconciliationMs;
    const maxReconnectAttempts = this.options.maxReconnectAttempts ?? SECURE_RUNTIME_LIMITS.maxReconnectAttempts;
    let reconnectAttempts = 0;
    let lastError: RuntimeError | undefined;
    let observedRun = false;
    try {
      while (true) {
        throwIfAborted(operation.signal);
        throwIfReconciliationExpired(deadlineAt, observedRun, lastError, maxReconciliationMs, this.deps);
        let terminal = false;
        try {
          const stream = await connected.client.stream(`/v1/runs/${encodeURIComponent(input.externalRunId)}/events`, {
            signal: operation.signal,
            timeoutMs: remainingMs(deadlineAt, this.deps),
          });
          observedRun = true;
          for await (const sse of parseSseStream(stream, { signal: operation.signal })) {
            const data = parseHermesEventData(sse.data);
            const key = eventDedupeKey(sse.id, sse.event, data);
            if (dedupe.seen(key)) continue;
            for (const event of mapHermesSseEvent(sse.event, data, this.eventContext(input, pendingApprovalIds, pendingToolIds))) {
              if (event.type === 'approval.requested') {
                this.approvals.set(approvalKey(input.externalRunId, event.approvalId), {
                  externalRunId: input.externalRunId,
                  choices: new Set(event.availableDecisions.map(toHermesChoice)),
                  resolving: false,
                });
              }
              if (event.type === 'approval.resolved') this.approvals.delete(approvalKey(input.externalRunId, event.approvalId));
              yield event;
              if (isTerminalEvent(event)) {
                terminal = true;
                this.clearRunApprovals(input.externalRunId);
                break;
              }
            }
            if (terminal) break;
          }
        } catch (error) {
          const normalized = normalizeStreamError(error, operation.signal);
          if (!isRetryable(normalized)) throw normalized;
          lastError = normalized;
        }
        if (terminal) return;
        throwIfReconciliationExpired(deadlineAt, observedRun, lastError, maxReconciliationMs, this.deps);

        let snapshot: RuntimeRunSnapshot | undefined;
        if (connected.capabilities.runs.status) {
          try {
            snapshot = await this.getRun(input, {
              ...options,
              signal: operation.signal,
              timeoutMs: remainingMs(deadlineAt, this.deps),
            });
            observedRun = true;
          } catch (error) {
            const normalized = normalizeStreamError(error, operation.signal);
            if (!isRetryable(normalized)) throw normalized;
            lastError = normalized;
          }
        }
        if (snapshot && isTerminalStatus(snapshot.status)) {
          yield terminalFromSnapshot(input, snapshot, this.deps);
          this.clearRunApprovals(input.externalRunId);
          return;
        }

        if (reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts += 1;
          const delayed = await this.delayWithinDeadline(
            retryDelay(lastError, this.options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS),
            operation.signal,
            deadlineAt,
          );
          if (!delayed) throw reconciliationError(observedRun, lastError, maxReconciliationMs);
          continue;
        }

        if (!connected.capabilities.runs.status) {
          throw reconciliationError(observedRun, lastError, maxReconciliationMs);
        }
        const pollingIntervalMs = this.options.pollingIntervalMs ?? DEFAULT_POLLING_INTERVAL_MS;
        let pollDelayMs = pollingIntervalMs;
        while (true) {
          const delayed = await this.delayWithinDeadline(pollDelayMs, operation.signal, deadlineAt);
          if (!delayed) throw reconciliationError(observedRun, lastError, maxReconciliationMs);
          try {
            snapshot = await this.getRun(input, {
              ...options,
              signal: operation.signal,
              timeoutMs: remainingMs(deadlineAt, this.deps),
            });
            observedRun = true;
            pollDelayMs = pollingIntervalMs;
            if (isTerminalStatus(snapshot.status)) {
              yield terminalFromSnapshot(input, snapshot, this.deps);
              this.clearRunApprovals(input.externalRunId);
              return;
            }
          } catch (error) {
            const normalized = normalizeStreamError(error, operation.signal);
            if (!isRetryable(normalized)) throw normalized;
            lastError = normalized;
            pollDelayMs = Math.max(pollingIntervalMs, retryDelay(normalized, pollingIntervalMs));
          }
        }
      }
    } finally {
      dedupe.clear();
      pendingApprovalIds.length = 0;
      pendingToolIds.clear();
      this.clearRunApprovals(input.externalRunId);
    }
  }

  async getRun(input: GetRuntimeRunInput, options?: OperationOptions): Promise<RuntimeRunSnapshot> {
    const connected = this.requireConnected();
    if (!connected.capabilities.runs.status) throw unsupported('Hermes run status is unavailable');
    const value = validateRunStatusResponse((await connected.client.json<unknown>('GET', `/v1/runs/${encodeURIComponent(input.externalRunId)}`, { signal: options?.signal, timeoutMs: options?.timeoutMs })).value);
    if (value.runId !== input.externalRunId) throw runtimeError('INVALID_RESPONSE', 'Hermes run status returned another run', false, { stage: 'run.status' });
    if (input.externalSessionId && value.sessionId && input.externalSessionId !== value.sessionId) throw runtimeError('INVALID_RESPONSE', 'Hermes run status returned another session', false, { stage: 'run.status' });
    const patch = sessionStatePatch(value.value);
    return {
      applicationRunId: input.applicationRunId,
      externalRunId: input.externalRunId,
      status: value.status,
      output: value.output,
      usage: value.usage,
      sessionStatePatch: patch,
      error: value.error ? { code: 'PROVIDER_ERROR', message: `Hermes run failed: ${value.error.code}`, retryable: false } : undefined,
      providerState: safeProviderState(patch?.providerState),
    };
  }

  async cancelRun(input: CancelRuntimeRunInput, options?: OperationOptions): Promise<void> {
    const connected = this.requireConnected();
    if (!connected.capabilities.runs.cancel) throw unsupported('Hermes run cancellation is unavailable');
    try {
      validateStopResponse((await connected.client.json<unknown>('POST', `/v1/runs/${encodeURIComponent(input.externalRunId)}/stop`, { signal: options?.signal, timeoutMs: options?.timeoutMs })).value, input.externalRunId);
    } catch (error) {
      if (!(error instanceof RuntimeError) || error.code !== 'NOT_FOUND' || !connected.capabilities.runs.status) throw error;
      const snapshot = await this.getRun(input, options);
      if (snapshot.status !== 'completed' && snapshot.status !== 'cancelled') throw error;
    }
  }

  async resolveApproval(input: ResolveRuntimeApprovalInput, options?: OperationOptions): Promise<void> {
    const connected = this.requireConnected();
    if (!connected.capabilities.runs.approvals) throw unsupported('Hermes approval resolution is unavailable');
    validateIdentifier(input.externalRunId, 'run id');
    validateIdentifier(input.approvalId, 'approval id');
    const key = approvalKey(input.externalRunId, input.approvalId);
    const state = this.approvals.get(key);
    if (!state) throw runtimeError('INVALID_REQUEST', 'Hermes approval ID is not active for this run', false);
    if (state.resolving) throw runtimeError('CONFLICT', 'Hermes approval resolution is already in progress', false);
    const choice = toHermesChoice(input.decision);
    if (!state.choices.has(choice)) throw runtimeError('INVALID_REQUEST', 'Hermes approval choice was not offered for this request', false, { choice });
    if (input.comment) throw unsupported('Hermes Runs approval comments are unavailable');
    state.resolving = true;
    try {
      validateApprovalResponse((await connected.client.json<unknown>('POST', `/v1/runs/${encodeURIComponent(input.externalRunId)}/approval`, {
        signal: options?.signal,
        timeoutMs: options?.timeoutMs,
        body: { choice },
      })).value, input.externalRunId, choice);
      this.approvals.delete(key);
    } catch (error) {
      if (error instanceof RuntimeError && error.code === 'CONFLICT') this.approvals.delete(key);
      else state.resolving = false;
      throw error;
    }
  }

  async getHistory(input: GetRuntimeHistoryInput, options?: OperationOptions): Promise<RuntimeMessage[]> {
    const connected = this.requireConnected();
    if (!connected.capabilities.sessions.history) throw unsupported('Hermes session message history is unavailable');
    return validateSessionMessagesResponse((await connected.client.json<unknown>('GET', `/api/sessions/${encodeURIComponent(input.externalSessionId)}/messages`, { signal: options?.signal, timeoutMs: options?.timeoutMs })).value, input.externalSessionId).messages;
  }

  async close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = this.closeResources();
    try {
      await this.closing;
    } finally {
      this.closing = undefined;
    }
  }

  private descriptor(connected: ConnectedHermes) {
    return {
      schemaVersion: 1 as const,
      adapterId: this.adapterId,
      adapterVersion: this.adapterVersion,
      runtimeProduct: 'hermes-agent',
      runtimeVersion: runtimeVersion(connected.capabilitiesPayload),
      protocolName: 'hermes-runs-http',
      protocolVersion: '1',
      endpointFingerprint: connected.descriptorFingerprint,
      capabilities: connected.capabilities,
    };
  }

  private eventContext(input: StreamRuntimeRunInput, pendingApprovalIds: string[], pendingToolIds: Map<string, string[]>) {
    return {
      ids: this.deps.ids,
      clock: this.deps.clock,
      applicationRunId: input.applicationRunId,
      externalRunId: input.externalRunId,
      externalSessionId: input.externalSessionId,
      includeRawProviderPayload: this.options.includeRawProviderPayload,
      pendingApprovalIds,
      pendingToolIds,
    };
  }

  private async delayWithinDeadline(delayMs: number, signal: AbortSignal, deadlineAt: number): Promise<boolean> {
    const remaining = remainingMs(deadlineAt, this.deps);
    if (remaining <= 0) return false;
    await this.deps.clock.sleep(Math.min(delayMs, remaining), signal);
    return remainingMs(deadlineAt, this.deps) > 0;
  }

  private clearRunApprovals(externalRunId: string): void {
    for (const [approvalId, state] of this.approvals) if (state.externalRunId === externalRunId) this.approvals.delete(approvalId);
  }

  private async closeResources(): Promise<void> {
    if (this.closed && !this.connected && this.activeStreams.size === 0) return;
    this.closed = true;
    const active = [...this.activeStreams];
    const reason = runtimeError('CANCELLED', 'Hermes adapter was closed', false);
    const stopping = active.map((operation) => operation.stop(reason));
    await this.connected?.client.close();
    await Promise.all(stopping);
    await Promise.all(active.map((operation) => operation.done));
    this.activeStreams.clear();
    this.approvals.clear();
    this.connected = undefined;
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
  const previousResponseId = stringValue(input.session.providerState?.previousResponseId ?? input.session.providerState?.hermesPreviousResponseId);
  const body: Record<string, unknown> = { input: input.input.text, session_id: input.session.externalSessionId, instructions: input.instructions, model: options.model };
  if (previousResponseId && options.historyMode !== 'conversation_history') body.previous_response_id = previousResponseId;
  else if (input.history?.length) body.conversation_history = input.history.map((message) => ({ role: message.role, content: message.content }));
  return compact(body);
}

function sessionHeaders(session: RuntimeSession, options: HermesAdapterOptions, capabilities: RuntimeCapabilities): Record<string, string> {
  const headers: Record<string, string> = {};
  if (capabilities.extensions['hermes.long_term_session_key'] === true) {
    const sessionKey = stringValue(session.providerState?.sessionKey);
    if (sessionKey) headers[options.sessionKeyHeader ?? 'X-Hermes-Session-Key'] = validateHeaderValue(sessionKey, 'session key');
  }
  if (capabilities.extensions['hermes.session_id_header'] === true) {
    headers[options.sessionIdHeader ?? 'X-Hermes-Session-Id'] = validateHeaderValue(session.externalSessionId, 'session id');
  }
  return headers;
}

function validateHeaderValue(value: string, label: string): string {
  if (!value || value.length > 256 || /[\u0000-\u001F\u007F]/.test(value)) throw runtimeError('INVALID_REQUEST', `Invalid Hermes ${label} header value`, false);
  return value;
}

function validateIdentifier(value: string, label: string): void {
  validateHeaderValue(value, label);
}

function safeIdentifier(value: unknown): string | undefined {
  const found = stringValue(value);
  return found ? validateHeaderValue(found, 'session id') : undefined;
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
  if (mode === 'rest-session' && (!capabilities.sessions.create || !capabilities.sessions.history)) throw unsupported('Hermes REST session mode is unavailable');
  return mode;
}

function rejectUnsupportedAttachments(input: StartRuntimeRunInput): void {
  if (input.input.attachments?.length) throw runtimeError('UNSUPPORTED_CAPABILITY', 'Hermes Runs API adapter supports text input only', false);
}

function sessionStatePatch(value: Record<string, unknown>): RuntimeSessionStatePatch | undefined {
  const externalSessionId = stringValue(value.session_id ?? value.sessionId);
  return externalSessionId ? { externalSessionId, providerState: { hermesSessionId: externalSessionId } } : undefined;
}

function terminalFromSnapshot(input: StreamRuntimeRunInput, snapshot: RuntimeRunSnapshot, deps: RuntimeAdapterDependencies): RuntimeEvent {
  const base = { schemaVersion: 1 as const, eventId: `reconciled:${deps.ids.id()}`, occurredAt: deps.clock.now().toISOString(), applicationRunId: input.applicationRunId, externalRunId: input.externalRunId, externalSessionId: input.externalSessionId, provider: { adapterId: 'hermes', eventName: 'status.reconciliation' } };
  if (snapshot.status === 'completed') return { ...base, type: 'run.completed', output: snapshot.output, usage: snapshot.usage, sessionStatePatch: snapshot.sessionStatePatch };
  if (snapshot.status === 'failed') return { ...base, type: 'run.failed', error: snapshot.error ?? { code: 'PROVIDER_ERROR', message: 'Hermes run failed', retryable: false }, sessionStatePatch: snapshot.sessionStatePatch };
  return { ...base, type: 'run.cancelled', sessionStatePatch: snapshot.sessionStatePatch };
}

function createStreamOperation(parent: AbortSignal | undefined, timeoutMs: number | undefined): StreamOperation {
  const controller = new AbortController();
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => { resolveDone = resolve; });
  const onAbort = () => controller.abort(parent?.reason instanceof RuntimeError ? parent.reason : runtimeError('CANCELLED', 'Hermes stream was cancelled', false));
  if (parent?.aborted) onAbort();
  else parent?.addEventListener('abort', onAbort, { once: true });
  const timeout = timeoutMs && timeoutMs > 0 ? setTimeout(() => controller.abort(runtimeError('TIMEOUT', 'Hermes stream timed out', true, { timeoutMs })), timeoutMs) : undefined;
  const operation: StreamOperation = {
    controller,
    signal: controller.signal,
    done,
    finish: resolveDone,
    stop: async (reason) => {
      controller.abort(reason);
    },
    cleanup: () => {
      if (timeout) clearTimeout(timeout);
      parent?.removeEventListener('abort', onAbort);
    },
  };
  return operation;
}

function trackStream(
  inner: AsyncIterator<RuntimeEvent>,
  operation: StreamOperation,
  onFinish: () => void,
): AsyncIterable<RuntimeEvent> {
  let finalized = false;
  let stopping: Promise<void> | undefined;
  const finalize = () => {
    if (finalized) return;
    finalized = true;
    operation.cleanup();
    onFinish();
    operation.finish();
  };
  const settle = async (result: Promise<IteratorResult<RuntimeEvent>>): Promise<IteratorResult<RuntimeEvent>> => {
    try {
      const next = await result;
      if (next.done) finalize();
      return next;
    } catch (error) {
      finalize();
      throw error;
    }
  };
  const iterator: AsyncIterator<RuntimeEvent> = {
    next: () => settle(Promise.resolve(inner.next())),
    return: async (value) => {
      try {
        return inner.return ? await inner.return(value) : { done: true, value };
      } finally {
        finalize();
      }
    },
    throw: async (error) => {
      try {
        if (inner.throw) return await inner.throw(error);
        throw error;
      } finally {
        finalize();
      }
    },
  };
  operation.stop = (reason) => {
    if (stopping) return stopping;
    stopping = (async () => {
      operation.controller.abort(reason);
      try {
        await inner.return?.();
      } catch {
        // The abort reason is delivered to an outstanding next() call.
      } finally {
        finalize();
      }
    })();
    return stopping;
  };
  return { [Symbol.asyncIterator]: () => iterator };
}

function eventDedupeKey(sseId: string | undefined, eventName: string | undefined, data: unknown): string {
  return sseId ? `sse:${hashString(sseId)}` : `event:${eventName ?? ''}:${hashString(stableJson(data))}`;
}

function hashString(value: string): string {
  let first = 2166136261;
  let second = 2246822507;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 3266489909);
  }
  return `${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`).join(',')}}`;
}

function normalizeStreamError(error: unknown, signal: AbortSignal): RuntimeError {
  if (error instanceof RuntimeError) return error;
  if (signal.aborted) return signal.reason instanceof RuntimeError ? signal.reason : runtimeError('CANCELLED', 'Hermes stream was cancelled', false);
  return runtimeError('PROVIDER_UNAVAILABLE', 'Hermes stream transport failed', true, { stage: 'stream' });
}

function isRetryable(error: RuntimeError): boolean {
  return error.retryable && ['NETWORK', 'TIMEOUT', 'RATE_LIMITED', 'RUNTIME_UNAVAILABLE', 'PROVIDER_UNAVAILABLE'].includes(error.code);
}

function retryDelay(error: RuntimeError | undefined, fallback: number): number {
  return error?.retryAfterMs ?? fallback;
}

function reconciliationError(observedRun: boolean, lastError: RuntimeError | undefined, maxMs: number): RuntimeError {
  if (observedRun) return runtimeError('TIMEOUT', 'Hermes run did not reach a terminal state before reconciliation expired', true, { maxReconciliationMs: maxMs });
  if (lastError?.code === 'PROVIDER_UNAVAILABLE' || lastError?.code === 'RUNTIME_UNAVAILABLE' || lastError?.code === 'RATE_LIMITED') return lastError;
  return runtimeError('OUTCOME_UNKNOWN', 'Hermes run state could not be reconciled', true, { maxReconciliationMs: maxMs });
}

function remainingMs(deadlineAt: number, deps: RuntimeAdapterDependencies): number {
  return Math.max(0, deadlineAt - deps.clock.now().getTime());
}

function throwIfReconciliationExpired(
  deadlineAt: number,
  observedRun: boolean,
  lastError: RuntimeError | undefined,
  maxMs: number,
  deps: RuntimeAdapterDependencies,
): void {
  if (remainingMs(deadlineAt, deps) <= 0) throw reconciliationError(observedRun, lastError, maxMs);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof RuntimeError ? signal.reason : runtimeError('CANCELLED', 'Hermes stream was cancelled', false);
}

function positiveInteger(value: number | undefined, name: string, allowZero = false, maximum = Number.MAX_SAFE_INTEGER): void {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > maximum) throw runtimeError('INVALID_CONFIGURATION', `${name} must be a safe bounded integer`, false);
}

function isTerminalStatus(status: RuntimeRunSnapshot['status']): status is 'completed' | 'failed' | 'cancelled' {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function toHttpBase(endpoint: string): string {
  return endpoint.replace(/^hermes\+http:/, 'http:').replace(/^hermes\+https:/, 'https:').replace(/^agent\+https:/, 'https:');
}

function runtimeVersion(value: Record<string, unknown>): string | undefined {
  return stringValue(value.version ?? value.runtimeVersion);
}

function healthStatus(status: unknown): RuntimeHealth['status'] {
  if (status === 'ok' || status === 'healthy') return 'healthy';
  if (status === 'degraded' || status === 'starting') return 'degraded';
  return 'unavailable';
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, nested]) => nested !== undefined));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function safeProviderState(value: unknown): Record<string, unknown> | undefined {
  const sanitized = sanitizeProviderPayload(value);
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized) ? sanitized as Record<string, unknown> : undefined;
}

function approvalKey(externalRunId: string, approvalId: string): string {
  return JSON.stringify([externalRunId, approvalId]);
}

function isOutcomeUnknown(error: unknown): boolean {
  return error instanceof RuntimeError && ['NETWORK', 'TIMEOUT', 'RUNTIME_UNAVAILABLE', 'PROVIDER_UNAVAILABLE'].includes(error.code);
}

function unsupported(message: string): RuntimeError {
  return runtimeError('UNSUPPORTED_CAPABILITY', message, false);
}

function normalizeAdapterError(error: unknown, stage: string): RuntimeError {
  if (error instanceof RuntimeError) return error;
  return runtimeError('PROVIDER_ERROR', 'Hermes adapter operation failed', false, { stage });
}

function shouldRethrowHealthError(error: unknown): boolean {
  return error instanceof RuntimeError && [
    'AUTHENTICATION_REQUIRED',
    'AUTHENTICATION_FAILED',
    'PERMISSION_DENIED',
    'INVALID_RESPONSE',
  ].includes(error.code);
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
