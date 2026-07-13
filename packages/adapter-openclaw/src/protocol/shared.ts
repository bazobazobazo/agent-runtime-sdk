import {
  RuntimeError,
  TEXT_RUN_CAPABILITIES,
  runtimeEventBase,
  type CancelRuntimeRunInput,
  type EnsureSessionInput,
  type GetRuntimeHistoryInput,
  type GetRuntimeRunInput,
  type RuntimeCapabilities,
  type RuntimeEvent,
  type StartRuntimeRunInput,
} from '@banzae/agent-runtime-core';
import type {
  OpenClawConnectInput,
  OpenClawFrame,
  OpenClawHello,
  OpenClawProviderEventMetadata,
  OpenClawProtocolCodec,
  OpenClawRpcRequest,
  OpenClawRunContext,
} from './types.js';

export abstract class BaseOpenClawCodec implements OpenClawProtocolCodec {
  abstract readonly protocolVersion: number;
  abstract readonly protocolName: `openclaw-gateway-v${number}`;

  createConnectParams(input: OpenClawConnectInput): Record<string, unknown> {
    const auth = authPayload(input.auth, input.deviceToken);
    return {
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
    };
  }

  parseHello(payload: unknown): OpenClawHello {
    const value = asRecord(payload);
    const auth = asRecord(value.auth);
    const server = asRecord(value.server);
    const features = asRecord(value.features);
    const protocolValue =
      numberValue(value.protocol) ??
      numberValue(value.protocolVersion) ??
      numberValue(value.selectedProtocol) ??
      this.protocolVersion;
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
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (parsed.type === 'hello-ok') return parsed as OpenClawFrame;
    if (parsed.type === 'res' && typeof parsed.id === 'string') return parsed as OpenClawFrame;
    if (parsed.type === 'req' && typeof parsed.id === 'string' && typeof parsed.method === 'string') {
      return parsed as OpenClawFrame;
    }
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
    throw new RuntimeError({
      code: 'PROVIDER_ERROR',
      retryable: false,
      message: 'Unrecognized OpenClaw frame',
      adapterId: 'openclaw',
    });
  }

  encodeRequest(input: OpenClawRpcRequest): string {
    return JSON.stringify({ type: 'req', id: input.id, method: input.method, params: input.params ?? {} });
  }

  extractProviderEventMetadata(event: Extract<OpenClawFrame, { type: 'event' }>): OpenClawProviderEventMetadata {
    const payload = asRecord(event.payload);
    const run = asRecord(payload.run);
    const session = asRecord(payload.session);
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
      occurredAt:
        validTimestamp(event.timestamp) ??
        validTimestamp(stringValue(payload.timestamp ?? payload.createdAt ?? payload.created_at ?? payload.time)),
      terminal: terminalOutcome(event.event, status),
    };
  }

  mapProviderEvent(event: Extract<OpenClawFrame, { type: 'event' }>, context: OpenClawRunContext): RuntimeEvent[] {
    const metadata = this.extractProviderEventMetadata(event);
    if (!eventMatchesRun(metadata, context)) return [];

    const payload = asRecord(event.payload);
    const text = stringValue(payload.text ?? payload.delta ?? payload.message ?? payload.content);
    const status = stringValue(payload.status);
    const occurredAt = eventOccurredAt(metadata, context);
    const provider = {
      adapterId: 'openclaw',
      eventName: event.event,
      ...(context.includeRawProviderPayload ? { raw: sanitizeProviderPayload(event.payload) } : {}),
    };

    if (isDeltaEvent(event.event) && text) {
      return [{ ...eventBase('assistant.delta', context, metadata, occurredAt, provider), type: 'assistant.delta', delta: text }];
    }
    if (isCompletedEvent(event.event) || metadata.terminal === 'completed' || status === 'completed') {
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
          error: {
            code: 'PROVIDER_ERROR',
            message: stringValue(payload.error) ?? 'OpenClaw run failed',
            retryable: false,
          },
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
    if (isRunScopedDiagnosticEvent(event.event)) {
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

  mapError(error: unknown): RuntimeError {
    if (error instanceof RuntimeError) return error;
    const providerError = asRecord(error);
    const providerDetails = asRecord(providerError.details);
    const providerCode = stringValue(providerError.code);
    const detailCode = stringValue(providerDetails.code);
    const message = stringValue(providerError.message) ?? (error instanceof Error ? error.message : String(error));
    const lower = message.toLowerCase();
    if (providerCode === 'NOT_PAIRED' || detailCode === 'PAIRING_REQUIRED' || lower.includes('pairing required')) {
      return new RuntimeError({
        code: 'PAIRING_REQUIRED',
        retryable: false,
        message,
        adapterId: 'openclaw',
        details: providerDetails,
        cause: error,
      });
    }
    if (lower.includes('protocol') || providerDetails.expectedProtocol !== undefined) {
      return new RuntimeError({
        code: 'PROTOCOL_MISMATCH',
        retryable: false,
        message,
        adapterId: 'openclaw',
        details: providerDetails,
        cause: error,
      });
    }
    if (lower.includes('auth') || lower.includes('token') || lower.includes('pair')) {
      return new RuntimeError({
        code: 'AUTHENTICATION_FAILED',
        retryable: false,
        message,
        adapterId: 'openclaw',
        details: providerDetails,
        cause: error,
      });
    }
    if (providerCode === 'INVALID_REQUEST') {
      return new RuntimeError({
        code: 'INVALID_REQUEST',
        retryable: false,
        message,
        adapterId: 'openclaw',
        details: providerDetails,
        cause: error,
      });
    }
    return new RuntimeError({
      code: 'PROVIDER_ERROR',
      retryable: false,
      message,
      adapterId: 'openclaw',
      details: providerDetails,
      cause: error,
    });
  }

  supportsMethod(method: string, hello: OpenClawHello): boolean {
    return hello.methods.includes(method);
  }

  capabilities(hello?: OpenClawHello): RuntimeCapabilities {
    const methods = new Set(hello?.methods ?? []);
    return {
      ...TEXT_RUN_CAPABILITIES,
      sessions: {
        create: methods.size === 0 || methods.has('sessions.create'),
        resume: true,
        history: methods.size === 0 || methods.has('chat.history') || methods.has('sessions.get'),
        fork: false,
      },
      runs: {
        start: methods.size === 0 || methods.has('chat.send') || methods.has('sessions.send'),
        status: methods.size === 0 || methods.has('agent.wait'),
        streamText: true,
        streamTools: (hello?.events ?? []).some((event) => event.includes('tool')),
        cancel: methods.size === 0 || methods.has('chat.abort') || methods.has('sessions.abort'),
        approvals: (hello?.events ?? []).some((event) => event.includes('approval')),
      },
      input: { text: true, images: false, files: false },
      output: {
        text: true,
        reasoning: Boolean(hello?.features.reasoning),
        tools: (hello?.events ?? []).some((event) => event.includes('tool')),
        usage: methods.has('usage.status') || methods.has('sessions.usage'),
      },
      extensions: {
        'openclaw.cron': methods.has('cron.add') || methods.has('cron.list'),
        'openclaw.channels': methods.has('channels.status'),
        'openclaw.protocol': this.protocolVersion,
      },
    };
  }

  buildSessionCreate(input: EnsureSessionInput): OpenClawRpcRequest {
    return {
      id: `session-create:${input.applicationSessionId}`,
      method: 'sessions.create',
      params: {
        key: input.applicationSessionId,
      },
    };
  }

  buildRunStart(input: StartRuntimeRunInput): OpenClawRpcRequest {
    const sessionKey = input.session.externalSessionId;
    return {
      id: `run-start:${input.applicationRunId}`,
      method: 'chat.send',
      params: {
        sessionKey,
        message: input.input.text,
        idempotencyKey: input.idempotencyKey,
        deliver: false,
      },
    };
  }

  buildRunWait(input: GetRuntimeRunInput): OpenClawRpcRequest {
    return {
      id: `run-wait:${input.applicationRunId}`,
      method: 'agent.wait',
      params: {
        runId: input.externalRunId,
      },
    };
  }

  buildHistory(input: GetRuntimeHistoryInput): OpenClawRpcRequest {
    return {
      id: `history:${input.externalSessionId}`,
      method: 'chat.history',
      params: {
        sessionKey: input.externalSessionId,
        limit: input.limit,
        cursor: input.cursor,
      },
    };
  }

  buildCancel(input: CancelRuntimeRunInput): OpenClawRpcRequest {
    return {
      id: `cancel:${input.externalRunId}`,
      method: 'chat.abort',
      params: {
        sessionKey: input.externalSessionId,
        runId: input.externalRunId,
      },
    };
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
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

function eventMatchesRun(metadata: OpenClawProviderEventMetadata, context: OpenClawRunContext): boolean {
  if (metadata.providerRunId) {
    if (metadata.providerRunId !== context.externalRunId) return false;
    return !metadata.sessionKey || metadata.sessionKey === context.externalSessionId;
  }
  if (!metadata.sessionKey || metadata.sessionKey !== context.externalSessionId) return false;
  return isSessionScopedRunEvent(metadata.eventType);
}

function eventOccurredAt(metadata: OpenClawProviderEventMetadata, context: OpenClawRunContext): Date {
  return metadata.occurredAt ? new Date(metadata.occurredAt) : context.clock.now();
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

function providerEventId(
  metadata: OpenClawProviderEventMetadata,
  type: RuntimeEvent['type'],
  context: OpenClawRunContext,
): string | undefined {
  if (metadata.providerEventId) return `${metadata.providerEventId}:${type}`;
  if (metadata.providerRunId && metadata.sequence != null) return `${metadata.providerRunId}:${metadata.sequence}:${type}`;
  if (!metadata.providerRunId && metadata.sessionKey && metadata.sequence != null) {
    return `${context.externalRunId}:${metadata.sessionKey}:${metadata.sequence}:${type}`;
  }
  return undefined;
}

function terminalOutcome(eventType: string, status?: string): OpenClawProviderEventMetadata['terminal'] {
  if (status === 'completed') return 'completed';
  if (status === 'failed' || status === 'error') return 'failed';
  if (status === 'cancelled' || status === 'canceled') return 'cancelled';
  if (status === 'timeout' || status === 'timed_out') return 'timeout';
  if (isCompletedEvent(eventType)) return 'completed';
  if (eventType === 'chat.failed' || eventType === 'run.failed' || eventType === 'agent.failed') return 'failed';
  if (eventType === 'chat.cancelled' || eventType === 'chat.canceled' || eventType === 'run.cancelled') return 'cancelled';
  if (eventType === 'chat.timeout' || eventType === 'run.timeout') return 'timeout';
  return undefined;
}

function isDeltaEvent(eventType: string): boolean {
  return eventType === 'chat.delta' || eventType === 'assistant.delta' || eventType === 'run.delta';
}

function isCompletedEvent(eventType: string): boolean {
  return eventType === 'chat.completed' || eventType === 'assistant.completed' || eventType === 'run.completed';
}

function isSessionScopedRunEvent(eventType: string): boolean {
  return (
    isDeltaEvent(eventType) ||
    isCompletedEvent(eventType) ||
    eventType === 'chat.failed' ||
    eventType === 'run.failed' ||
    eventType === 'agent.failed' ||
    eventType === 'chat.cancelled' ||
    eventType === 'chat.canceled' ||
    eventType === 'run.cancelled' ||
    eventType === 'chat.timeout' ||
    eventType === 'run.timeout'
  );
}

function isRunScopedDiagnosticEvent(eventType: string): boolean {
  return eventType === 'chat.warning' || eventType === 'run.warning' || eventType === 'transport.warning';
}

function validTimestamp(value?: string): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

const SENSITIVE_PROVIDER_KEY = /(token|authorization|signature|cookie|password|secret|credential|private.?key|device.?token)/i;

function sanitizeProviderPayload(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map(sanitizeProviderPayload);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        SENSITIVE_PROVIDER_KEY.test(key) ? '[redacted]' : sanitizeProviderPayload(nested),
      ]),
    );
  }
  return String(value);
}
