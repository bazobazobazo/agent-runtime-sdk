import type { RuntimeError } from './errors.js';
import type { RuntimeEvent, RuntimeEventBase, RuntimeEventName } from './types.js';

export function runtimeEventBase(input: {
  ids: { id(): string };
  now: Date;
  type: RuntimeEventName;
  applicationRunId: string;
  externalRunId: string;
  externalSessionId: string;
  sequence?: number;
  provider?: RuntimeEventBase['provider'];
}): RuntimeEventBase {
  return {
    schemaVersion: 1,
    eventId: `${input.type}:${input.ids.id()}`,
    occurredAt: input.now.toISOString(),
    applicationRunId: input.applicationRunId,
    externalRunId: input.externalRunId,
    externalSessionId: input.externalSessionId,
    sequence: input.sequence,
    provider: input.provider,
  };
}

export function isTerminalEvent(event: RuntimeEvent): boolean {
  return event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.cancelled';
}

export function isTerminalRuntimeRunStatus(status: import('./types.js').RuntimeRunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

export function isActiveRuntimeRunStatus(status: import('./types.js').RuntimeRunStatus): boolean {
  return status === 'queued' || status === 'running' || status === 'waiting_for_approval' || status === 'stopping';
}

export function failedEventFromError(
  base: RuntimeEventBase,
  error: RuntimeError,
): RuntimeEvent {
  return {
    ...base,
    type: 'run.failed',
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    },
  };
}

export class SequenceTracker {
  private last?: number;

  accept(next?: number): { gap: boolean; expected?: number; actual?: number } {
    if (next == null) return { gap: false };
    const expected = this.last == null ? next : this.last + 1;
    const gap = this.last != null && next !== expected;
    this.last = next;
    return gap ? { gap, expected, actual: next } : { gap: false };
  }
}
