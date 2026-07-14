import { RuntimeError, type RuntimeClock, type RuntimeIdGenerator } from '@banzae/agent-runtime-core';

export class DeterministicRuntimeClock implements RuntimeClock {
  readonly sleeps: number[] = [];

  constructor(private current = new Date('2026-01-01T00:00:00.000Z').getTime()) {}

  now(): Date {
    return new Date(this.current);
  }

  async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw signal.reason ?? new RuntimeError({ code: 'CANCELLED', retryable: false, message: 'Deterministic sleep cancelled' });
    this.sleeps.push(ms);
    this.current += ms;
  }

  advance(ms: number): void {
    this.current += ms;
  }
}

export class DeterministicRuntimeIdGenerator implements RuntimeIdGenerator {
  private sequence = 0;

  constructor(private readonly prefix = 'conformance') {}

  id(): string {
    this.sequence += 1;
    return `${this.prefix}-${this.sequence}`;
  }
}

export function createSecretMarker(label: string): string {
  const normalized = label.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  return `conformance-secret-${normalized}-do-not-expose`;
}

export function assertSecretMarkersAbsent(value: unknown, markers: readonly string[]): void {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const marker of markers) {
    if (serialized.includes(marker)) throw new Error(`Secret marker was exposed: ${marker}`);
  }
}
