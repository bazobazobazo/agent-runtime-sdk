import {
  RuntimeError,
  NO_CAPABILITIES,
  runtimeEventBase,
  type CancelRuntimeRunInput,
  type EnsureSessionInput,
  type GetRuntimeHistoryInput,
  type GetRuntimeRunInput,
  type RuntimeCapabilities,
  type RuntimeEvent,
  type RuntimeRunSnapshot,
  type StartRuntimeRunInput,
} from '@banzae/agent-runtime-core';
import type {
  OpenClawCancelResult,
  OpenClawChallenge,
  OpenClawConnectInput,
  OpenClawFrame,
  OpenClawHello,
  OpenClawProviderEventMetadata,
  OpenClawProtocolCodec,
  OpenClawRpcRequest,
  OpenClawRunContext,
  OpenClawRunStartResult,
} from '../types.js';
import {
  asRecord,
  booleanValue,
  numberValue,
  optionalRecord,
  protocolError,
  protocolMismatch,
  sanitizeOpenClawPayload,
  stringArray,
  stringValue,
  validTimestamp,
} from './validation.js';

export type OpenClawProtocolMappings = {
  connectEvent: string;
  connectMethod: string;
  sessionCreateMethod: string;
  runStartMethod: string;
  runWaitMethod: string;
  historyMethod: string;
  cancelMethod: string;
  deltaEvents: readonly string[];
  completedEvents: readonly string[];
  failedEvents: readonly string[];
  cancelledEvents: readonly string[];
  timeoutEvents: readonly string[];
  diagnosticEvents: readonly string[];
};

export abstract class MappedOpenClawCodec implements OpenClawProtocolCodec {
  abstract readonly protocolVersion: number;
  abstract readonly protocolName: `openclaw-gateway-v${number}`;
  protected abstract readonly mappings: OpenClawProtocolMappings;

  parseChallenge(frame: OpenClawFrame): OpenClawChallenge | undefined {
    if (frame.type !== 'event' || frame.event !== this.mappings.connectEvent) return undefined;
    const payload = optionalRecord(frame.payload);
    return { nonce: stringValue(payload.nonce), raw: frame };
  }

  createConnectParams(input: OpenClawConnectInput): Record<string, unknown> {
    const auth = authPayload(input.auth, input.deviceToken);
    return compactObject({
      minProtocol: this.protocolVersion,
      maxProtocol: this.protocolVersion,
      client: {
        id: input.clientId ?? input.clientName ?? 'gateway-client',
        version: input.clientVersion ?? '0.1.0',
        platform: input.clientPlatform ?? 'node',
        mode: input.clientMode ?? 'backend',
      },
      role: input.role ?? 'operator',
      scopes: input.scopes ?? ['operator.read', 'operator.write'],
      caps: ['tool-events'],
      auth,
      locale: input.locale ?? 'en-US',
      userAgent: input.userAgent ?? '@banzae/agent-runtime-openclaw/0.1.0',
      device: input.device,
    });
  }

  parseHello(payload: unknown): OpenClawHello {
    const value = asRecord(payload, 'OpenClaw hello response');
    const auth = optionalRecord(value.auth);
    const server = optionalRecord(value.server);
    const features = optionalRecord(value.features);
    const protocolValue =
      numberValue(value.protocol) ??
      numberValue(value.protocolVersion) ??
      numberValue(value.selectedProtocol) ??
      this.protocolVersion;
    if (protocolValue !== this.protocolVersion) {
      throw protocolMismatch(`OpenClaw selected protocol ${protocolValue}, expected ${this.protocolVersion}`, {
        selectedProtocol: protocolValue,
        expectedProtocol: this.protocolVersion,
      });
    }
    return {
      protocolVersion: protocolValue,
      runtimeVersion: stringValue(value.serverVersion) ?? stringValue(value.version) ?? stringValue(server.version),
      connectionId: stringValue(value.connectionId) ?? stringValue(server.connId),
      methods: stringArray(value.methods ?? features.methods ?? auth.methods),
      events: stringArray(value.events ?? features.events),
      features,
      raw: payload,
    };
  }

  parseFrame(input: string | Uint8Array): OpenClawFrame {
    const text = typeof input === 'string' ? input : new TextDecoder().decode(input);
    let parsed: Record<string, unknown>;
    try {
      parsed = asRecord(JSON.parse(text), 'OpenClaw frame');
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      throw protocolError('OpenClaw frame was not valid JSON', { cause: String(error) });
    }

    if (parsed.type === 'hello-ok') return parsed as OpenClawFrame;
    if (parsed.type === 'res' && typeof parsed.id === 'string') return parsed as OpenClawFrame;
    if (parsed.type === 'req' && typeof parsed.id === 'string' && typeof parsed.method === 'string') return parsed as OpenClawFrame;
    if (typeof parsed.event === 'string') {
      return {
        type: 'event',
        event: parsed.event,
        payload: parsed.payload,
        seq: numberValue(parsed.seq ?? parsed.sequence),
        eventId: stringValue(parsed.id ?? parsed.eventId),
        timestamp: stringValue(parsed.timestamp ?? parsed.createdAt),
      };
    }
    throw protocolError('Unrecognized OpenClaw frame', { frameType: parsed.type });
  }

  encodeRequest(input: OpenClawRpcRequest): string {
    return JSON.stringify({ type: 'req', id: input.id, method: input.method, params: input.params ?? {} });
  }

  extractProviderEventMetadata(event: Extract<OpenClawFrame, { type: 'event' }>): OpenClawProviderEventMetadata {
    const payload = optionalRecord(event.payload);
    const run = optionalRecord(payload.run);
    const session = optionalRecord(payload.session);
    const status = stringValue(payload.status ?? run.status);
    return {
      eventType: event.event,
      providerRunId:
        stringValue(payload.runId) ??
        stringValue(payload.run_id) ??
        stringValue(payload.providerRunId) ??
        stringValue(payload.externalRunId) ??
        stringValue(run.id) ??
        stringValue(run.runId),
      sessionKey:
        stringValue(payload.sessionKey) ??
        stringValue(payload.session_key) ??
        stringValue(payload.sessionId) ??
        stringValue(payload.session_id) ??
        stringValue(session.key) ??
        stringValue(session.id),
      providerEventId:
        event.eventId ??
        stringValue(payload.eventId) ??
        stringValue(payload.event_id) ??
        stringValue(payload.providerEventId) ??
        stringValue(payload.id),
      sequence: event.seq ?? numberValue(payload.seq ?? payload.sequence),
      occurredAt: validTimestamp(event.timestamp) ?? validTimestamp(stringValue(payload.timestamp ?? payload.createdAt ?? payload.created_at ?? payload.time)),
      terminal: terminalOutcome(this.mappings, event.event, status),
    };
  }

  mapProviderEvent(event: Extract<OpenClawFrame, { type: 'event' }>, context: OpenClawRunContext): RuntimeEvent[] {
    const metadata = this.extractProviderEventMetadata(event);
    if (!eventMatchesRun(this.mappings, metadata, context)) return [];

    const payload = optionalRecord(event.payload);
    const text = stringValue(payload.text ?? payload.delta ?? payload.message ?? payload.content);
    const status = stringValue(payload.status);
    const occurredAt = metadata.occurredAt ? new Date(metadata.occurredAt) : context.clock.now();
    const provider = {
      adapterId: 'openclaw',
      eventName: event.event,
      ...(context.includeRawProviderPayload ? { raw: sanitizeOpenClawPayload(event.payload) } : {}),
    };

    if (this.mappings.deltaEvents.includes(event.event) && text) {
      return [{ ...eventBase('assistant.delta', context, metadata, occurredAt, provider), type: 'assistant.delta', delta: text }];
    }
    if (this.mappings.completedEvents.includes(event.event) || metadata.terminal === 'completed' || status === 'completed') {
      const events: RuntimeEvent[] = [];
      if (text) {
        events.push({ ...eventBase('assistant.completed', context, metadata, occurredAt, provider), type: 'assistant.completed', text });
      }
      events.push({ ...eventBase('run.completed', context, metadata, occurredAt, provider), type: 'run.completed' });
      return events;
    }
    if (metadata.terminal === 'failed' || status === 'failed') {
      return [
        {
          ...eventBase('run.failed', context, metadata, occurredAt, provider),
          type: 'run.failed',
          error: { code: 'PROVIDER_ERROR', message: stringValue(payload.error) ?? 'OpenClaw run failed', retryable: false },
        },
      ];
    }
    if (metadata.terminal === 'cancelled' || status === 'cancelled' || status === 'canceled') {
      return [{ ...eventBase('run.cancelled', context, metadata, occurredAt, provider), type: 'run.cancelled' }];
    }
    if (metadata.terminal === 'timeout' || status === 'timeout' || status === 'timed_out') {
      return [
        {
          ...eventBase('run.failed', context, metadata, occurredAt, provider),
          type: 'run.failed',
          error: { code: 'TIMEOUT', message: 'OpenClaw run timed out', retryable: true },
        },
      ];
    }
    if (this.mappings.diagnosticEvents.includes(event.event)) {
      return [
        {
          ...eventBase('transport.warning', context, metadata, occurredAt, provider),
          type: 'transport.warning',
          warning: `Unmapped OpenClaw event ${event.event}`,
        },
      ];
    }
    return [];
  }

  parseRunStartResponse(payload: unknown): OpenClawRunStartResult {
    const value = asRecord(payload, 'OpenClaw run-start response');
    const externalRunId = stringValue(value.runId) ?? stringValue(value.id);
    if (!externalRunId) {
      throw new RuntimeError({
        code: 'PROVIDER_ERROR',
        retryable: false,
        adapterId: 'openclaw',
        message: 'OpenClaw accepted run start without returning a provider run id',
        details: { protocolVersion: this.protocolVersion, method: this.mappings.runStartMethod },
      });
    }
    return {
      externalRunId,
      status: normalizeStatus(value.status),
      providerState: { adapterId: 'openclaw', protocolVersion: this.protocolVersion, method: this.mappings.runStartMethod, response: value },
    };
  }

  parseRunWaitResponse(input: GetRuntimeRunInput, payload: unknown): RuntimeRunSnapshot {
    const response = asRecord(payload, 'OpenClaw run-status response');
    return {
      applicationRunId: input.applicationRunId,
      externalRunId: input.externalRunId,
      status: normalizeStatus(response.status),
      output: stringValue(response.output ?? response.text ?? response.message),
      usage: typeof response.usage === 'object' && response.usage ? (response.usage as Record<string, number>) : undefined,
      providerState: response,
    };
  }

  parseCancelResponse(payload: unknown): OpenClawCancelResult {
    const value = payload == null ? {} : asRecord(payload, 'OpenClaw cancel response');
    return { accepted: booleanValue(value.accepted) ?? true, raw: value };
  }

  mapError(error: unknown): RuntimeError {
    if (error instanceof RuntimeError) return error;
    const providerError = optionalRecord(error);
    const providerDetails = optionalRecord(providerError.details);
    const providerCode = stringValue(providerError.code);
    const detailCode = stringValue(providerDetails.code);
    const message = stringValue(providerError.message) ?? (error instanceof Error ? error.message : String(error));
    const lower = message.toLowerCase();
    if (providerCode === 'NOT_PAIRED' || detailCode === 'PAIRING_REQUIRED' || lower.includes('pairing required')) {
      return new RuntimeError({ code: 'PAIRING_REQUIRED', retryable: false, message, adapterId: 'openclaw', details: providerDetails, cause: error });
    }
    if (lower.includes('permission') || lower.includes('forbidden') || lower.includes('missing scope')) {
      return new RuntimeError({ code: 'PERMISSION_DENIED', retryable: false, message, adapterId: 'openclaw', details: providerDetails, cause: error });
    }
    if (lower.includes('auth') || lower.includes('token') || providerCode === 'AUTHENTICATION_FAILED') {
      return new RuntimeError({ code: 'AUTHENTICATION_FAILED', retryable: false, message, adapterId: 'openclaw', details: providerDetails, cause: error });
    }
    if (lower.includes('protocol') || providerDetails.expectedProtocol !== undefined || detailCode === 'PROTOCOL_MISMATCH') {
      return new RuntimeError({ code: 'PROTOCOL_MISMATCH', retryable: false, message, adapterId: 'openclaw', details: providerDetails, cause: error });
    }
    if (providerCode === 'INVALID_REQUEST') {
      return new RuntimeError({ code: 'INVALID_REQUEST', retryable: false, message, adapterId: 'openclaw', details: providerDetails, cause: error });
    }
    return new RuntimeError({ code: 'PROVIDER_ERROR', retryable: false, message, adapterId: 'openclaw', details: providerDetails, cause: error });
  }

  supportsMethod(method: string, hello: OpenClawHello): boolean {
    return hello.methods.includes(method);
  }

  capabilities(hello?: OpenClawHello): RuntimeCapabilities {
    const methods = new Set(hello?.methods ?? []);
    const events = new Set(hello?.events ?? []);
    const runStart = methods.has(this.mappings.runStartMethod) || methods.has('sessions.send');
    const runStream = this.mappings.deltaEvents.some((event) => events.has(event))
      && this.mappings.completedEvents.some((event) => events.has(event));
    return {
      ...NO_CAPABILITIES,
      sessions: {
        create: methods.has(this.mappings.sessionCreateMethod),
        resume: runStart,
        history: methods.has(this.mappings.historyMethod) || methods.has('sessions.get'),
        fork: false,
      },
      runs: {
        start: runStart,
        status: methods.has(this.mappings.runWaitMethod),
        streamText: runStream,
        streamTools: false,
        cancel: methods.has(this.mappings.cancelMethod) || methods.has('sessions.abort'),
        approvals: false,
      },
      input: { text: runStart, images: false, files: false },
      output: {
        text: runStream || methods.has(this.mappings.runWaitMethod),
        reasoning: false,
        tools: false,
        usage: false,
      },
      extensions: {
        'openclaw.cron': methods.has('cron.add') || methods.has('cron.list'),
        'openclaw.channels': methods.has('channels.status'),
        'openclaw.protocol': this.protocolVersion,
      },
    };
  }

  buildSessionCreate(input: EnsureSessionInput): OpenClawRpcRequest {
    return { id: `session-create:${input.applicationSessionId}`, method: this.mappings.sessionCreateMethod, params: { key: input.applicationSessionId } };
  }

  buildRunStart(input: StartRuntimeRunInput): OpenClawRpcRequest {
    return {
      id: `run-start:${input.applicationRunId}`,
      method: this.mappings.runStartMethod,
      params: { sessionKey: input.session.externalSessionId, message: input.input.text, idempotencyKey: input.idempotencyKey, deliver: false },
    };
  }

  buildRunWait(input: GetRuntimeRunInput): OpenClawRpcRequest {
    return { id: `run-wait:${input.applicationRunId}`, method: this.mappings.runWaitMethod, params: { runId: input.externalRunId } };
  }

  buildHistory(input: GetRuntimeHistoryInput): OpenClawRpcRequest {
    return {
      id: `history:${input.externalSessionId}`,
      method: this.mappings.historyMethod,
      params: { sessionKey: input.externalSessionId, limit: input.limit, cursor: input.cursor },
    };
  }

  buildCancel(input: CancelRuntimeRunInput): OpenClawRpcRequest {
    return { id: `cancel:${input.externalRunId}`, method: this.mappings.cancelMethod, params: { sessionKey: input.externalSessionId, runId: input.externalRunId } };
  }
}

function authPayload(auth: OpenClawConnectInput['auth'], deviceToken?: string): Record<string, unknown> | undefined {
  if (!auth || auth.kind === 'none') return undefined;
  if (auth.kind === 'token' || auth.kind === 'bearer') return compactObject({ token: auth.token, deviceToken });
  if (auth.kind === 'device-token') return compactObject({ deviceToken: auth.token });
  if (auth.kind === 'password') return compactObject({ username: auth.username, password: auth.password });
  return undefined;
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, nested]) => nested !== undefined));
}

function eventMatchesRun(mappings: OpenClawProtocolMappings, metadata: OpenClawProviderEventMetadata, context: OpenClawRunContext): boolean {
  if (metadata.providerRunId) {
    if (metadata.providerRunId !== context.externalRunId) return false;
    return !metadata.sessionKey || metadata.sessionKey === context.externalSessionId;
  }
  if (!metadata.sessionKey || metadata.sessionKey !== context.externalSessionId) return false;
  return isSessionScopedRunEvent(mappings, metadata.eventType);
}

function eventBase(
  type: RuntimeEvent['type'],
  context: OpenClawRunContext,
  metadata: OpenClawProviderEventMetadata,
  now: Date,
  provider: NonNullable<ReturnType<typeof runtimeEventBase>['provider']>,
) {
  return runtimeEventBase({
    ids: { id: () => providerEventId(metadata, type, context) ?? context.ids.id() },
    now,
    type,
    applicationRunId: context.applicationRunId,
    externalRunId: context.externalRunId,
    externalSessionId: context.externalSessionId,
    sequence: metadata.sequence,
    provider,
  });
}

function providerEventId(metadata: OpenClawProviderEventMetadata, type: RuntimeEvent['type'], context: OpenClawRunContext): string | undefined {
  if (metadata.providerEventId) return `${metadata.providerEventId}:${type}`;
  if (metadata.providerRunId && metadata.sequence != null) return `${metadata.providerRunId}:${metadata.sequence}:${type}`;
  if (!metadata.providerRunId && metadata.sessionKey && metadata.sequence != null) return `${context.externalRunId}:${metadata.sessionKey}:${metadata.sequence}:${type}`;
  return undefined;
}

function terminalOutcome(mappings: OpenClawProtocolMappings, eventType: string, status?: string): OpenClawProviderEventMetadata['terminal'] {
  if (status === 'completed') return 'completed';
  if (status === 'failed' || status === 'error') return 'failed';
  if (status === 'cancelled' || status === 'canceled') return 'cancelled';
  if (status === 'timeout' || status === 'timed_out') return 'timeout';
  if (mappings.completedEvents.includes(eventType)) return 'completed';
  if (mappings.failedEvents.includes(eventType)) return 'failed';
  if (mappings.cancelledEvents.includes(eventType)) return 'cancelled';
  if (mappings.timeoutEvents.includes(eventType)) return 'timeout';
  return undefined;
}

function isSessionScopedRunEvent(mappings: OpenClawProtocolMappings, eventType: string): boolean {
  return (
    mappings.deltaEvents.includes(eventType) ||
    mappings.completedEvents.includes(eventType) ||
    mappings.failedEvents.includes(eventType) ||
    mappings.cancelledEvents.includes(eventType) ||
    mappings.timeoutEvents.includes(eventType)
  );
}

function normalizeStatus(status: unknown): RuntimeRunSnapshot['status'] {
  if (status === 'queued' || status === 'running' || status === 'waiting_for_approval' || status === 'stopping') return status;
  if (status === 'completed' || status === 'failed' || status === 'cancelled') return status;
  return 'unknown';
}
