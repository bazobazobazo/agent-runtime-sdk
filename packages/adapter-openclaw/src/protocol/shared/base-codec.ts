import {
  RuntimeError,
  NO_CAPABILITIES,
  type CancelRuntimeRunInput,
  type CreateRuntimeScheduleInput,
  type EnsureSessionInput,
  type GetRuntimeHistoryInput,
  type GetRuntimeRunInput,
  type GetRuntimeScheduleInput,
  type ListRuntimeSchedulesInput,
  type RuntimeCapabilities,
  type RuntimeEvent,
  type RuntimeAttachment,
  type RuntimeRunSnapshot,
  type StartRuntimeRunInput,
  type UpdateRuntimeScheduleInput,
} from '@banzae/agent-runtime-core';
import { runtimeEventBase } from '@banzae/agent-runtime-core/experimental';
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
  scheduleCreateMethod: string;
  scheduleGetMethod: string;
  scheduleListMethod: string;
  scheduleUpdateMethod: string;
  scheduleDeleteMethod: string;
  scheduleTriggerMethod: string;
  scheduleHistoryMethod: string;
  scheduleCreateShape: 'wrapped-v3' | 'root-v4';
  attachmentKinds: readonly RuntimeAttachment['kind'][];
  attachmentFileName: boolean;
  statefulEvents: readonly string[];
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
    const payload = asRecord(frame.payload, 'OpenClaw challenge payload');
    const nonce = safeIdentifier(payload.nonce, 'OpenClaw challenge nonce');
    return { nonce, raw: frame };
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
      numberValue(value.selectedProtocol);
    if (!Number.isSafeInteger(protocolValue)) throw protocolError('OpenClaw hello protocol version was malformed');
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
      methods: strictStringArray(value.methods ?? features.methods ?? auth.methods, 'OpenClaw hello methods'),
      events: strictStringArray(value.events ?? features.events, 'OpenClaw hello events'),
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
      throw protocolError('OpenClaw frame was not valid JSON', { stage: 'frame.parse' });
    }

    if (parsed.type === 'hello-ok') return parsed as OpenClawFrame;
    if (parsed.type === 'res') {
      safeIdentifier(parsed.id, 'OpenClaw response id');
      return parsed as OpenClawFrame;
    }
    if (parsed.type === 'req') {
      safeIdentifier(parsed.id, 'OpenClaw request id');
      safeIdentifier(parsed.method, 'OpenClaw request method');
      return parsed as OpenClawFrame;
    }
    if (typeof parsed.event === 'string') {
      const event = safeIdentifier(parsed.event, 'OpenClaw event name');
      const sequenceValue = parsed.seq ?? parsed.sequence;
      const sequence = sequenceValue === undefined ? undefined : safeSequence(sequenceValue);
      const eventIdValue = parsed.id ?? parsed.eventId;
      return {
        type: 'event',
        event,
        payload: parsed.payload,
        seq: sequence,
        eventId: eventIdValue === undefined ? undefined : safeIdentifier(eventIdValue, 'OpenClaw event id'),
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
    const message = optionalRecord(payload.message);
    const status = stringValue(payload.status ?? payload.state ?? run.status);
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
      messageId: stringValue(payload.messageId) ?? stringValue(payload.message_id) ?? stringValue(message.id),
      parentMessageId:
        stringValue(payload.parentId) ??
        stringValue(payload.parent_id) ??
        stringValue(payload.parentMessageId) ??
        stringValue(message.parentId),
      rawStatus: status,
      sequence: event.seq ?? numberValue(payload.seq ?? payload.sequence),
      occurredAt: validTimestamp(event.timestamp) ?? validTimestamp(stringValue(payload.timestamp ?? payload.createdAt ?? payload.created_at ?? payload.time)),
      terminal: terminalOutcome(this.mappings, event.event, status),
    };
  }

  mapProviderEvent(event: Extract<OpenClawFrame, { type: 'event' }>, context: OpenClawRunContext): RuntimeEvent[] {
    const metadata = this.extractProviderEventMetadata(event);
    if (!eventMatchesRun(this.mappings, metadata, context)) return [];

    const payload = optionalRecord(event.payload);
    const text = eventText(payload);
    const state = stringValue(payload.state ?? payload.status)?.toLowerCase();
    const occurredAt = metadata.occurredAt ? new Date(metadata.occurredAt) : context.clock.now();
    const provider = {
      adapterId: 'openclaw',
      eventName: event.event,
      ...(context.includeRawProviderPayload ? { sanitizedRawPayload: sanitizeOpenClawPayload(event.payload) } : {}),
    };

    const isStateful = this.mappings.statefulEvents.includes(event.event);
    if ((this.mappings.deltaEvents.includes(event.event) || (isStateful && state === 'delta')) && text) {
      return [{ ...eventBase('assistant.delta', context, metadata, occurredAt, provider), type: 'assistant.delta', delta: text }];
    }
    if (this.mappings.completedEvents.includes(event.event) || (isStateful && isCompletedStatus(state))) {
      if (!text) {
        return [{
          ...eventBase('transport.warning', context, metadata, occurredAt, provider),
          type: 'transport.warning',
          warning: 'OpenClaw terminal event omitted final text; status reconciliation is required',
        }];
      }
      const events: RuntimeEvent[] = [];
      events.push({ ...eventBase('assistant.completed', context, metadata, occurredAt, provider), type: 'assistant.completed', text });
      events.push({ ...eventBase('run.completed', context, metadata, occurredAt, provider), type: 'run.completed', output: text });
      return events;
    }
    if (this.mappings.failedEvents.includes(event.event) || (isStateful && isFailedStatus(state))) {
      return [
        {
          ...eventBase('run.failed', context, metadata, occurredAt, provider),
          type: 'run.failed',
          error: { code: 'PROVIDER_ERROR', message: 'OpenClaw run failed', retryable: false },
        },
      ];
    }
    if (this.mappings.cancelledEvents.includes(event.event) || (isStateful && isCancelledStatus(state))) {
      return [{ ...eventBase('run.cancelled', context, metadata, occurredAt, provider), type: 'run.cancelled' }];
    }
    if (this.mappings.timeoutEvents.includes(event.event)) {
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
      providerState: { adapterId: 'openclaw', protocolVersion: this.protocolVersion, method: this.mappings.runStartMethod },
    };
  }

  parseRunWaitResponse(input: GetRuntimeRunInput, payload: unknown): RuntimeRunSnapshot {
    const response = asRecord(payload, 'OpenClaw run-status response');
    const providerRunId = response.runId ?? response.run_id ?? response.id;
    if (providerRunId !== undefined && safeIdentifier(providerRunId, 'OpenClaw run-status run id') !== input.externalRunId) {
      throw protocolError('OpenClaw run-status response returned another run');
    }
    if (typeof response.status !== 'string' || !response.status) throw protocolError('OpenClaw run-status response omitted status');
    const rawStatus = response.status;
    const normalizedStatus = normalizeStatus(rawStatus);
    const output = stringValue(response.output ?? response.text ?? response.message);
    if (normalizedStatus === 'completed' && output === undefined && String(rawStatus).toLowerCase() !== 'ok') {
      throw protocolError('OpenClaw completed run omitted output');
    }
    const status = normalizedStatus === 'completed' && output === undefined ? 'unknown' : normalizedStatus;
    const usage = response.usage === undefined ? undefined : strictUsage(response.usage);
    return {
      applicationRunId: input.applicationRunId,
      externalRunId: input.externalRunId,
      status,
      output,
      usage,
      providerState: {
        ...input.providerState,
        adapterId: 'openclaw',
        protocolVersion: this.protocolVersion,
        rawStatus,
        status,
        terminalStatus: normalizedStatus === 'completed' ? 'completed' : undefined,
        completionEvidence: status === 'completed' ? 'terminal-status' : undefined,
      },
    };
  }

  parseCancelResponse(payload: unknown): OpenClawCancelResult {
    const value = payload == null ? {} : asRecord(payload, 'OpenClaw cancel response');
    const runIds = Array.isArray(value.runIds)
      ? value.runIds.filter((candidate): candidate is string =>
          typeof candidate === 'string' && candidate.length > 0,
        )
      : [];
    const accepted =
      booleanValue(value.accepted) ??
      booleanValue(value.aborted) ??
      (runIds.length > 0 ? true : undefined) ??
      true;
    return { accepted, raw: value };
  }

  mapError(error: unknown): RuntimeError {
    if (error instanceof RuntimeError) return error;
    const providerError = optionalRecord(error);
    const providerDetails = optionalRecord(providerError.details);
    const providerCode = stringValue(providerError.code);
    const detailCode = stringValue(providerDetails.code);
    const providerMessage = stringValue(providerError.message) ?? '';
    const lower = providerMessage.toLowerCase();
    if (providerCode === 'RATE_LIMITED' || providerCode === 'TOO_MANY_REQUESTS' || lower.includes('rate limit')) {
      const retryAfterMs = numberValue(providerError.retryAfterMs ?? providerDetails.retryAfterMs);
      return new RuntimeError({ code: 'RATE_LIMITED', retryable: true, retryAfterMs, message: 'OpenClaw rate limit was reached', adapterId: 'openclaw' });
    }
    if (providerCode === 'TIMEOUT' || lower.includes('timed out')) {
      return new RuntimeError({ code: 'TIMEOUT', retryable: true, message: 'OpenClaw request timed out', adapterId: 'openclaw' });
    }
    if (providerCode === 'NOT_PAIRED' || detailCode === 'PAIRING_REQUIRED' || lower.includes('pairing required')) {
      return new RuntimeError({ code: 'PAIRING_REQUIRED', retryable: false, message: 'OpenClaw device pairing is required', adapterId: 'openclaw', details: providerDetails });
    }
    if (providerCode === 'AUTHORIZATION_FAILED' || providerCode === 'PERMISSION_DENIED' || detailCode === 'AUTHORIZATION_FAILED' || detailCode === 'PERMISSION_DENIED' || lower.includes('permission') || lower.includes('forbidden') || lower.includes('missing scope')) {
      return new RuntimeError({ code: 'PERMISSION_DENIED', retryable: false, message: 'OpenClaw permission was denied', adapterId: 'openclaw', details: providerDetails });
    }
    if (lower.includes('auth') || lower.includes('token') || providerCode === 'AUTHENTICATION_FAILED' || providerCode === 'TOKEN_EXPIRED') {
      return new RuntimeError({ code: 'AUTHENTICATION_FAILED', retryable: false, message: 'OpenClaw authentication failed', adapterId: 'openclaw', details: providerDetails });
    }
    if (lower.includes('protocol') || providerDetails.expectedProtocol !== undefined || detailCode === 'PROTOCOL_MISMATCH') {
      return new RuntimeError({ code: 'PROTOCOL_MISMATCH', retryable: false, message: 'OpenClaw protocol negotiation failed', adapterId: 'openclaw', details: providerDetails });
    }
    if (providerCode === 'INVALID_REQUEST') {
      return new RuntimeError({ code: 'INVALID_REQUEST', retryable: false, message: 'OpenClaw rejected the request', adapterId: 'openclaw', details: providerDetails });
    }
    return new RuntimeError({ code: 'PROVIDER_ERROR', retryable: false, message: 'OpenClaw returned a provider error', adapterId: 'openclaw', details: providerDetails });
  }

  supportsMethod(method: string, hello: OpenClawHello): boolean {
    return hello.methods.includes(method);
  }

  capabilities(hello?: OpenClawHello): RuntimeCapabilities {
    const methods = new Set(hello?.methods ?? []);
    const events = new Set(hello?.events ?? []);
    const runStart = methods.has(this.mappings.runStartMethod) || methods.has('sessions.send');
    const runStream = this.mappings.statefulEvents.some((event) => events.has(event))
      || (this.mappings.deltaEvents.some((event) => events.has(event))
        && this.mappings.completedEvents.some((event) => events.has(event)));
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
        stream: runStream,
        cancel: methods.has(this.mappings.cancelMethod) || methods.has('sessions.abort'),
        approvals: false,
      },
      input: {
        text: runStart,
        images: runStart && this.mappings.attachmentKinds.includes('image'),
        files: runStart && this.mappings.attachmentKinds.includes('file'),
      },
      output: {
        text: runStream || methods.has(this.mappings.runWaitMethod),
        reasoning: false,
        tools: false,
        usage: false,
      },
      health: {
        liveness: true,
        readiness: methods.has('health') || methods.has('status'),
      },
      schedules: {
        create: methods.has(this.mappings.scheduleCreateMethod),
        get: methods.has(this.mappings.scheduleGetMethod) || methods.has(this.mappings.scheduleListMethod),
        list: methods.has(this.mappings.scheduleListMethod),
        update: methods.has(this.mappings.scheduleUpdateMethod),
        delete: methods.has(this.mappings.scheduleDeleteMethod),
        enable: methods.has(this.mappings.scheduleUpdateMethod),
        pause: methods.has(this.mappings.scheduleUpdateMethod),
        trigger: methods.has(this.mappings.scheduleTriggerMethod),
        history: methods.has(this.mappings.scheduleHistoryMethod),
      },
      extensions: {
        'openclaw.cron': methods.has('cron.add') || methods.has('cron.list'),
        'openclaw.channels': methods.has('channels.status'),
        'openclaw.protocol': this.protocolVersion,
        'openclaw.attachments.transport': 'chat.send-inline-base64',
        'openclaw.attachments.images': this.mappings.attachmentKinds.includes('image')
          ? 'supported-by-protocol'
          : 'unsupported-by-protocol',
        'openclaw.attachments.files': this.mappings.attachmentKinds.includes('file')
          ? 'supported-by-protocol'
          : 'unsupported-by-protocol',
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
      params: {
        sessionKey: input.session.externalSessionId,
        message: input.input.text,
        idempotencyKey: input.idempotencyKey,
        deliver: false,
        ...(input.input.attachments?.length
          ? { attachments: input.input.attachments.map((attachment) => this.encodeAttachment(attachment)) }
          : {}),
      },
    };
  }

  private encodeAttachment(attachment: RuntimeAttachment): Record<string, unknown> {
    if (!this.mappings.attachmentKinds.includes(attachment.kind)) {
      throw new RuntimeError({
        code: 'UNSUPPORTED_CAPABILITY',
        retryable: false,
        adapterId: 'openclaw',
        message: `OpenClaw protocol v${this.protocolVersion} does not support ${attachment.kind} attachments`,
      });
    }
    return compactObject({
      type: attachment.kind,
      mimeType: attachment.mimeType,
      ...(this.mappings.attachmentFileName ? { fileName: attachment.name } : {}),
      content: bytesToBase64(attachment.data),
    });
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

  buildScheduleCreate(input: CreateRuntimeScheduleInput): OpenClawRpcRequest {
    const job = scheduleJob(input, this.mappings.scheduleCreateShape === 'root-v4');
    const params = this.mappings.scheduleCreateShape === 'root-v4'
      ? job
      : { job, idempotencyKey: input.idempotencyKey };
    return { id: `schedule-create:${input.idempotencyKey}`, method: this.mappings.scheduleCreateMethod, params };
  }

  buildScheduleGet(input: GetRuntimeScheduleInput): OpenClawRpcRequest {
    return { id: `schedule-get:${input.externalScheduleId}`, method: this.mappings.scheduleGetMethod, params: { jobId: input.externalScheduleId } };
  }

  buildScheduleList(input: ListRuntimeSchedulesInput = {}): OpenClawRpcRequest {
    return { id: 'schedule-list', method: this.mappings.scheduleListMethod, params: compactObject({ limit: input.limit, cursor: input.cursor }) };
  }

  buildScheduleUpdate(input: UpdateRuntimeScheduleInput): OpenClawRpcRequest {
    return { id: `schedule-update:${input.externalScheduleId}`, method: this.mappings.scheduleUpdateMethod, params: { jobId: input.externalScheduleId, patch: schedulePatch(input) } };
  }

  buildScheduleDelete(input: GetRuntimeScheduleInput): OpenClawRpcRequest {
    return { id: `schedule-delete:${input.externalScheduleId}`, method: this.mappings.scheduleDeleteMethod, params: { jobId: input.externalScheduleId } };
  }

  buildScheduleEnable(input: GetRuntimeScheduleInput, enabled: boolean): OpenClawRpcRequest {
    return this.buildScheduleUpdate({ ...input, enabled });
  }

  buildSchedulePause(input: GetRuntimeScheduleInput, paused: boolean): OpenClawRpcRequest {
    return this.buildScheduleUpdate({ ...input, enabled: !paused });
  }

  buildScheduleTrigger(input: GetRuntimeScheduleInput): OpenClawRpcRequest {
    return { id: `schedule-trigger:${input.externalScheduleId}`, method: this.mappings.scheduleTriggerMethod, params: { jobId: input.externalScheduleId } };
  }

  buildScheduleHistory(input: GetRuntimeScheduleInput & ListRuntimeSchedulesInput): OpenClawRpcRequest {
    return { id: `schedule-history:${input.externalScheduleId}`, method: this.mappings.scheduleHistoryMethod, params: compactObject({ jobId: input.externalScheduleId, limit: input.limit, cursor: input.cursor }) };
  }
}

function bytesToBase64(value: Uint8Array): string {
  const BufferCtor = (globalThis as { Buffer?: { from(value: Uint8Array): { toString(encoding: 'base64'): string } } }).Buffer;
  if (BufferCtor) return BufferCtor.from(value).toString('base64');
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  if (typeof btoa !== 'function') throw protocolError('No base64 encoder is available');
  return btoa(binary);
}

function scheduleJob(input: CreateRuntimeScheduleInput, requireV4Defaults = false): Record<string, unknown> {
  return compactObject({
    name: input.name,
    schedule: scheduleTiming(input.timing),
    payload: input.payload.kind === 'system-event'
      ? { kind: 'systemEvent', text: input.payload.text }
      : { kind: 'agentTurn', message: input.payload.text },
    sessionTarget: input.payload.sessionTarget ?? (requireV4Defaults ? input.payload.kind === 'system-event' ? 'main' : 'isolated' : undefined),
    wakeMode: requireV4Defaults ? 'now' : undefined,
    delivery: input.payload.deliveryChannel ? { mode: 'announce', channel: input.payload.deliveryChannel } : undefined,
    enabled: input.enabled,
  });
}

function schedulePatch(input: UpdateRuntimeScheduleInput): Record<string, unknown> {
  return compactObject({
    name: input.name,
    schedule: input.timing ? scheduleTiming(input.timing) : undefined,
    payload: input.payload
      ? input.payload.kind === 'system-event'
        ? { kind: 'systemEvent', text: input.payload.text }
        : { kind: 'agentTurn', message: input.payload.text }
      : undefined,
    sessionTarget: input.payload?.sessionTarget,
    delivery: input.payload?.deliveryChannel ? { mode: 'announce', channel: input.payload.deliveryChannel } : undefined,
    enabled: input.enabled,
  });
}

function scheduleTiming(input: CreateRuntimeScheduleInput['timing']): Record<string, unknown> {
  if (input.kind === 'once') return { kind: 'at', at: input.at };
  if (input.kind === 'cron') return compactObject({ kind: 'cron', expr: input.expression, tz: input.timezone });
  return compactObject({ kind: 'every', everyMs: input.everyMs, startsAt: input.startsAt });
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

function terminalOutcome(mappings: OpenClawProtocolMappings, eventType: string, _status?: string): OpenClawProviderEventMetadata['terminal'] {
  const status = _status?.toLowerCase();
  if (mappings.statefulEvents.includes(eventType)) {
    if (isCompletedStatus(status)) return 'completed';
    if (isFailedStatus(status)) return 'failed';
    if (isCancelledStatus(status)) return 'cancelled';
  }
  if (mappings.completedEvents.includes(eventType)) return 'completed';
  if (mappings.failedEvents.includes(eventType)) return 'failed';
  if (mappings.cancelledEvents.includes(eventType)) return 'cancelled';
  if (mappings.timeoutEvents.includes(eventType)) return 'timeout';
  return undefined;
}

function safeIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value.length > 256 || /[\u0000-\u001F\u007F]/.test(value)) {
    throw protocolError(`${label} was malformed`);
  }
  return value;
}

function safeSequence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw protocolError('OpenClaw event sequence was malformed');
  return value;
}

function strictStringArray(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw protocolError(`${label} was malformed`);
  return value.map((item) => safeIdentifier(item, label));
}

function strictUsage(value: unknown): Readonly<Record<string, number>> {
  const usage = asRecord(value, 'OpenClaw usage');
  const output: Record<string, number> = {};
  for (const [key, nested] of Object.entries(usage)) {
    if (typeof nested !== 'number' || !Number.isFinite(nested) || nested < 0) throw protocolError('OpenClaw usage was malformed');
    output[key] = nested;
  }
  return output;
}

function isSessionScopedRunEvent(mappings: OpenClawProtocolMappings, eventType: string): boolean {
  return (
    mappings.statefulEvents.includes(eventType) ||
    mappings.deltaEvents.includes(eventType) ||
    mappings.completedEvents.includes(eventType) ||
    mappings.failedEvents.includes(eventType) ||
    mappings.cancelledEvents.includes(eventType) ||
    mappings.timeoutEvents.includes(eventType)
  );
}

function normalizeStatus(status: unknown): RuntimeRunSnapshot['status'] {
  if (typeof status !== 'string') return 'unknown';
  const normalized = status.toLowerCase();
  if (normalized === 'accepted' || normalized === 'pending') return 'queued';
  if (normalized === 'in_flight') return 'running';
  if (normalized === 'queued' || normalized === 'running' || normalized === 'waiting_for_approval' || normalized === 'stopping') return normalized;
  if (isCompletedStatus(normalized)) return 'completed';
  if (isFailedStatus(normalized)) return 'failed';
  if (isCancelledStatus(normalized)) return 'cancelled';
  return 'unknown';
}

function isCompletedStatus(status?: string): boolean {
  return status === 'completed' || status === 'complete' || status === 'done' || status === 'final' || status === 'ok';
}

function isFailedStatus(status?: string): boolean {
  return status === 'failed' || status === 'error';
}

function isCancelledStatus(status?: string): boolean {
  return status === 'cancelled' || status === 'canceled' || status === 'aborted';
}

function eventText(payload: Record<string, unknown>): string | undefined {
  const direct = stringValue(payload.text ?? payload.delta ?? payload.deltaText ?? payload.content);
  if (direct) return direct;
  const message = optionalRecord(payload.message);
  return normalizedText(message.content ?? message.text);
}

function normalizedText(value: unknown): string | undefined {
  if (typeof value === 'string') return value || undefined;
  if (!Array.isArray(value)) return undefined;
  const text = value
    .map((part) => (typeof part === 'string' ? part : stringValue(optionalRecord(part).text)))
    .filter((part): part is string => typeof part === 'string')
    .join('');
  return text || undefined;
}
