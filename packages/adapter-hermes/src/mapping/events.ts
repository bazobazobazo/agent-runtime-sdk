import {
  RuntimeError,
  runtimeEventBase,
  type RuntimeEvent,
  type RuntimeIdGenerator,
} from '@banzae/agent-runtime-core';

export type HermesEventContext = {
  ids: RuntimeIdGenerator;
  applicationRunId: string;
  externalRunId: string;
  externalSessionId: string;
};

export function mapHermesSseEvent(eventName: string | undefined, data: unknown, context: HermesEventContext): RuntimeEvent[] {
  const payload = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const effectiveEventName = eventName ?? stringValue(payload.event);
  const status = stringValue(payload.status);
  const text = stringValue(payload.text ?? payload.delta ?? payload.output ?? payload.message);
  const base = runtimeEventBase({
    ids: context.ids,
    now: new Date(),
    type: 'transport.warning',
    applicationRunId: context.applicationRunId,
    externalRunId: context.externalRunId,
    externalSessionId: context.externalSessionId,
      provider: { adapterId: 'hermes', eventName: effectiveEventName, raw: data },
    });

  if (effectiveEventName?.includes('delta') && text) return [{ ...base, type: 'assistant.delta', delta: text }];
  if ((effectiveEventName?.includes('completed') || status === 'completed') && text) {
    return [
      { ...base, type: 'assistant.completed', text },
      { ...base, type: 'run.completed' },
    ];
  }
  if (status === 'completed') return [{ ...base, type: 'run.completed' }];
  if (status === 'cancelled') return [{ ...base, type: 'run.cancelled' }];
  if (status === 'failed') {
    return [
      {
        ...base,
        type: 'run.failed',
        error: { code: 'PROVIDER_ERROR', message: stringValue(payload.error) ?? 'Hermes run failed', retryable: false },
      },
    ];
  }
  if (payload.usage && typeof payload.usage === 'object') {
    return [{ ...base, type: 'usage.updated', usage: payload.usage as Record<string, number> }];
  }
  return [{ ...base, type: 'transport.warning', warning: `Unmapped Hermes event ${effectiveEventName ?? 'message'}` }];
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
      cause: error,
    });
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}
