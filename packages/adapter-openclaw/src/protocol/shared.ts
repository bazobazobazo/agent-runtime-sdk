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

  mapProviderEvent(event: Extract<OpenClawFrame, { type: 'event' }>, context: OpenClawRunContext): RuntimeEvent[] {
    const now = new Date();
    const base = runtimeEventBase({
      ids: { id: () => `${event.event}:${event.seq ?? now.getTime()}` },
      now,
      type: 'transport.warning',
      applicationRunId: context.applicationRunId,
      externalRunId: context.externalRunId,
      externalSessionId: context.externalSessionId,
      sequence: event.seq,
      provider: { adapterId: 'openclaw', eventName: event.event, raw: event.payload },
    });

    const payload = asRecord(event.payload);
    const text = stringValue(payload.text ?? payload.delta ?? payload.message ?? payload.content);
    const status = stringValue(payload.status);

    if (/delta|chunk|message/.test(event.event) && text) {
      return [{ ...base, type: 'assistant.delta', delta: text }];
    }
    if (/final|completed/.test(event.event) && text) {
      return [
        { ...base, type: 'assistant.completed', text },
        { ...base, type: 'run.completed' },
      ];
    }
    if (status === 'completed') return [{ ...base, type: 'run.completed' }];
    if (status === 'failed') {
      return [
        {
          ...base,
          type: 'run.failed',
          error: {
            code: 'PROVIDER_ERROR',
            message: stringValue(payload.error) ?? 'OpenClaw run failed',
            retryable: false,
          },
        },
      ];
    }
    return [{ ...base, type: 'transport.warning', warning: `Unmapped OpenClaw event ${event.event}` }];
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
      input: { text: true, images: Boolean(hello?.features.images), files: false },
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
