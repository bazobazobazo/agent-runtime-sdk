import {
  RuntimeError,
  runtimeEventBase,
  type RuntimeAdapterDependencies,
  type RuntimeEvent,
} from '@banzae/agent-runtime-core';

export type HermesEventContext = {
  ids: RuntimeAdapterDependencies['ids'];
  clock: RuntimeAdapterDependencies['clock'];
  applicationRunId: string;
  externalRunId: string;
  externalSessionId: string;
  includeRawProviderPayload?: boolean;
};

export function mapHermesSseEvent(eventName: string | undefined, data: unknown, context: HermesEventContext): RuntimeEvent[] {
  const payload = record(data);
  const effectiveEventName = eventName ?? stringValue(payload.event) ?? stringValue(payload.type);
  if (!effectiveEventName) return [warning(context, effectiveEventName, data, 'Hermes SSE event did not include an event name')];
  if (!matchesRun(payload, context)) return [];

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
    case 'run.started':
    case 'run.created':
      return [{ ...base, type: 'run.started' }];
    case 'assistant.delta':
    case 'message.delta': {
      const delta = requiredString(payload.delta ?? payload.text, 'Hermes assistant delta');
      return [{ ...base, type: 'assistant.delta', delta }];
    }
    case 'assistant.completed':
    case 'message.completed': {
      const text = stringValue(payload.text ?? payload.output ?? payload.message) ?? '';
      return [{ ...base, type: 'assistant.completed', text }];
    }
    case 'tool.started':
    case 'tool_call.started': {
      const toolCallId = requiredString(payload.tool_call_id ?? payload.toolCallId ?? payload.id, 'Hermes tool start id');
      return [{ ...base, type: 'tool.started', toolCallId, name: stringValue(payload.name ?? payload.tool_name) }];
    }
    case 'tool.completed':
    case 'tool_call.completed': {
      const toolCallId = requiredString(payload.tool_call_id ?? payload.toolCallId ?? payload.id, 'Hermes tool completion id');
      return [{ ...base, type: 'tool.completed', toolCallId, result: sanitizePreview(payload.result ?? payload.output) }];
    }
    case 'approval.required':
    case 'approval.requested': {
      const approvalId = requiredString(payload.approval_id ?? payload.approvalId ?? payload.id, 'Hermes approval id');
      return [{ ...base, type: 'approval.requested', approvalId, description: stringValue(payload.summary ?? payload.description ?? payload.tool_name) ?? 'Hermes approval required' }];
    }
    case 'usage.updated':
    case 'run.usage':
      return [{ ...base, type: 'usage.updated', usage: usage(payload.usage ?? payload) }];
    case 'run.completed':
      return [{ ...base, type: 'run.completed' }];
    case 'run.failed':
      return [{ ...base, type: 'run.failed', error: normalizedRunError(payload.error) }];
    case 'run.cancelled':
      return [{ ...base, type: 'run.cancelled' }];
    default:
      return [warning(context, effectiveEventName, data, `Unmapped Hermes event ${effectiveEventName}`)];
  }
}

export function parseHermesEventData(data: string): unknown {
  try {
    return data ? JSON.parse(data) : {};
  } catch (error) {
    throw new RuntimeError({
      code: 'PROVIDER_ERROR',
      retryable: false,
      adapterId: 'hermes',
      message: 'Hermes SSE event data was not valid JSON',
      details: safeErrorDetails(error, 'sse.json'),
      cause: error,
    });
  }
}

function matchesRun(payload: Record<string, unknown>, context: HermesEventContext): boolean {
  const runId = stringValue(payload.run_id ?? payload.runId);
  const sessionId = stringValue(payload.session_id ?? payload.sessionId);
  if (runId && runId !== context.externalRunId) return false;
  if (sessionId && sessionId !== context.externalSessionId) return false;
  return true;
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

function usage(value: unknown): Record<string, number> {
  const input = record(value);
  const output: Record<string, number> = {};
  for (const [key, nested] of Object.entries(input)) {
    if (typeof nested === 'number' && Number.isFinite(nested)) output[key] = nested;
  }
  return output;
}

function normalizedRunError(value: unknown) {
  const input = record(value);
  return {
    code: 'PROVIDER_ERROR' as const,
    message: stringValue(input.code) ? `Hermes run failed: ${input.code}` : 'Hermes run failed',
    retryable: false,
  };
}

function requiredString(value: unknown, label: string): string {
  const found = stringValue(value);
  if (!found) throw new RuntimeError({ code: 'PROVIDER_ERROR', retryable: false, adapterId: 'hermes', message: `${label} was missing` });
  return found;
}

function sanitizePreview(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return redact(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitizePreview);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        /(token|authorization|cookie|password|secret|credential|api.?key|session.?key)/i.test(key) ? '[redacted]' : sanitizePreview(nested),
      ]),
    );
  }
  return String(value);
}

function redact(value: string): string {
  return value
    .replace(/\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Authorization: Bearer [redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(token|access_token|api_key|password|cookie|secret|authorization|device_token|session_key)=([^&\s]+)/gi, '$1=[redacted]');
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function safeErrorDetails(error: unknown, stage: string): Record<string, unknown> {
  const details: Record<string, unknown> = { stage };
  if (error && typeof error === 'object' && typeof (error as { name?: unknown }).name === 'string') details.name = (error as { name: string }).name;
  return details;
}
