import {
  RuntimeError,
  runtimeEventBase,
  type RuntimeAdapterDependencies,
  type RuntimeApprovalDecision,
  type RuntimeEvent,
} from '@banzae/agent-runtime-core';
import {
  validateApprovalRequest,
  validateTerminalEvent,
  validateUsage,
  type HermesApprovalChoice,
} from '../schemas.js';

export type HermesEventContext = {
  ids: RuntimeAdapterDependencies['ids'];
  clock: RuntimeAdapterDependencies['clock'];
  applicationRunId: string;
  externalRunId: string;
  externalSessionId: string;
  includeRawProviderPayload?: boolean;
  pendingApprovalIds?: string[];
  pendingToolIds?: Map<string, string[]>;
};

const PROVEN_EVENTS = new Set([
  'message.delta',
  'tool.started',
  'tool.completed',
  'reasoning.available',
  'approval.request',
  'approval.responded',
  'run.completed',
  'run.failed',
  'run.cancelled',
]);

export function mapHermesSseEvent(eventName: string | undefined, data: unknown, context: HermesEventContext): RuntimeEvent[] {
  const payload = requiredRecord(data, 'Hermes SSE event');
  const effectiveEventName = eventName ?? requiredString(payload.event, 'Hermes SSE event name');
  if (!PROVEN_EVENTS.has(effectiveEventName)) {
    return [warning(context, effectiveEventName, data, `Unmapped Hermes event ${effectiveEventName}`)];
  }
  if (payload.event !== effectiveEventName) {
    throw invalidResponse('Hermes SSE event field did not match the SSE event name', 'sse.event');
  }
  const correlation = correlate(payload, context);
  if (correlation) return [warning(context, effectiveEventName, undefined, correlation)];

  const base = runtimeEventBase({
    ids: context.ids,
    now: context.clock.now(),
    type: 'transport.warning',
    applicationRunId: context.applicationRunId,
    externalRunId: context.externalRunId,
    externalSessionId: context.externalSessionId,
    provider: provider(effectiveEventName, data, context),
  });

  switch (effectiveEventName) {
    case 'message.delta':
      return [{ ...base, type: 'assistant.delta', delta: requiredString(payload.delta, 'Hermes message delta') }];
    case 'tool.started': {
      const name = requiredString(payload.tool, 'Hermes tool name');
      optionalString(payload.preview, 'Hermes tool preview');
      const toolCallId = `hermes-tool:${base.eventId}`;
      const pending = context.pendingToolIds?.get(name) ?? [];
      pending.push(toolCallId);
      context.pendingToolIds?.set(name, pending);
      return [{ ...base, type: 'tool.started', toolCallId, name }];
    }
    case 'tool.completed': {
      const name = requiredString(payload.tool, 'Hermes tool name');
      if (payload.error !== undefined && typeof payload.error !== 'boolean') throw invalidResponse('Hermes tool error flag was malformed', 'sse.tool');
      const pending = context.pendingToolIds?.get(name);
      const toolCallId = pending?.shift() ?? `hermes-tool:${base.eventId}`;
      if (pending?.length === 0) context.pendingToolIds?.delete(name);
      return [{ ...base, type: 'tool.completed', toolCallId, result: { error: payload.error === true } }];
    }
    case 'reasoning.available':
      return [{ ...base, type: 'reasoning.delta', delta: requiredString(payload.text, 'Hermes reasoning text') }];
    case 'approval.request': {
      const approval = validateApprovalRequest(payload);
      const approvalId = `hermes-approval:${base.eventId}`;
      context.pendingApprovalIds?.push(approvalId);
      return [{
        ...base,
        type: 'approval.requested',
        approvalId,
        description: approval.description,
        availableDecisions: approval.choices.map(fromHermesChoice),
      }];
    }
    case 'approval.responded': {
      const choice = validateChoice(payload.choice);
      if (typeof payload.resolved !== 'number' || !Number.isInteger(payload.resolved) || payload.resolved < 1) {
        throw invalidResponse('Hermes approval response event was malformed', 'sse.approval');
      }
      const approvalId = context.pendingApprovalIds?.shift();
      if (!approvalId) return [warning(context, effectiveEventName, data, 'Hermes approval response had no correlated request')];
      return [{ ...base, type: 'approval.resolved', approvalId, decision: fromHermesChoice(choice) }];
    }
    case 'run.completed': {
      validateTerminalEvent(payload, 'run.completed');
      return [{
        ...base,
        type: 'run.completed',
        output: requiredText(payload.output, 'Hermes completed output'),
        usage: payload.usage === undefined ? undefined : validateUsage(payload.usage),
        sessionStatePatch: sessionPatch(payload),
      }];
    }
    case 'run.failed': {
      validateTerminalEvent(payload, 'run.failed');
      return [{ ...base, type: 'run.failed', error: normalizedRunError(payload.error), sessionStatePatch: sessionPatch(payload) }];
    }
    case 'run.cancelled': {
      validateTerminalEvent(payload, 'run.cancelled');
      return [{ ...base, type: 'run.cancelled', sessionStatePatch: sessionPatch(payload) }];
    }
  }
  throw invalidResponse('Hermes SSE event was unsupported', 'sse.event');
}

export function parseHermesEventData(data: string): unknown {
  try {
    return data ? JSON.parse(data) : {};
  } catch (error) {
    throw new RuntimeError({
      code: 'INVALID_RESPONSE',
      retryable: false,
      adapterId: 'hermes',
      message: 'Hermes SSE event data was not valid JSON',
      details: safeErrorDetails(error, 'sse.json'),
      cause: error,
    });
  }
}

export function toHermesChoice(decision: RuntimeApprovalDecision): HermesApprovalChoice {
  return decision.action === 'deny' ? 'deny' : decision.scope;
}

export function fromHermesChoice(choice: HermesApprovalChoice): RuntimeApprovalDecision {
  return choice === 'deny' ? { action: 'deny' } : { action: 'allow', scope: choice };
}

function correlate(payload: Record<string, unknown>, context: HermesEventContext): string | undefined {
  const runId = requiredIdentifier(payload.run_id, 'Hermes SSE run_id');
  if (runId !== context.externalRunId) return 'Ignored Hermes event for another run';
  if (payload.session_id !== undefined) {
    const sessionId = requiredIdentifier(payload.session_id, 'Hermes SSE session_id');
    if (sessionId !== context.externalSessionId) return 'Ignored Hermes event for another session';
  }
  return undefined;
}

function provider(eventName: string, data: unknown, context: HermesEventContext) {
  return { adapterId: 'hermes', eventName, raw: context.includeRawProviderPayload ? sanitizePreview(data) : undefined };
}

function warning(context: HermesEventContext, eventName: string | undefined, data: unknown, message: string): RuntimeEvent {
  const base = runtimeEventBase({
    ids: context.ids,
    now: context.clock.now(),
    type: 'transport.warning',
    applicationRunId: context.applicationRunId,
    externalRunId: context.externalRunId,
    externalSessionId: context.externalSessionId,
    provider: provider(eventName ?? 'message', data, context),
  });
  return { ...base, type: 'transport.warning', warning: message };
}

function normalizedRunError(value: unknown) {
  const code = typeof value === 'object' && value && !Array.isArray(value)
    ? stringValue((value as Record<string, unknown>).code)
    : undefined;
  return { code: 'PROVIDER_ERROR' as const, message: code ? `Hermes run failed: ${code}` : 'Hermes run failed', retryable: false };
}

function sessionPatch(payload: Record<string, unknown>) {
  const externalSessionId = stringValue(payload.session_id);
  return externalSessionId ? { externalSessionId, providerState: { hermesSessionId: externalSessionId } } : undefined;
}

function validateChoice(value: unknown): HermesApprovalChoice {
  if (value !== 'once' && value !== 'session' && value !== 'always' && value !== 'deny') {
    throw invalidResponse('Hermes approval choice was malformed', 'sse.approval');
  }
  return value;
}

function sanitizePreview(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return redact(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitizePreview);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      /(token|authorization|cookie|password|secret|credential|api.?key|session.?key|command|arguments?)/i.test(key)
        ? '[redacted]'
        : sanitizePreview(nested),
    ]));
  }
  return String(value);
}

function redact(value: string): string {
  return value
    .replace(/\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Authorization: Bearer [redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(token|access_token|api_key|password|cookie|secret|authorization|device_token|session_key)=([^&\s]+)/gi, '$1=[redacted]');
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidResponse(`${label} was malformed`, 'sse.schema');
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw invalidResponse(`${label} was malformed`, 'sse.schema');
  return value;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string') throw invalidResponse(`${label} was malformed`, 'sse.schema');
  return value;
}

function requiredIdentifier(value: unknown, label: string): string {
  const found = requiredString(value, label);
  if (found.length > 256 || /[\u0000-\u001F\u007F]/.test(found)) throw invalidResponse(`${label} was unsafe`, 'sse.schema');
  return found;
}

function optionalString(value: unknown, label: string): void {
  if (value !== undefined && value !== null) requiredString(value, label);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function invalidResponse(message: string, stage: string): RuntimeError {
  return new RuntimeError({ code: 'INVALID_RESPONSE', retryable: false, adapterId: 'hermes', message, details: { stage } });
}

function safeErrorDetails(error: unknown, stage: string): Record<string, unknown> {
  const details: Record<string, unknown> = { stage };
  if (error && typeof error === 'object' && typeof (error as { name?: unknown }).name === 'string') details.name = (error as { name: string }).name;
  return details;
}
