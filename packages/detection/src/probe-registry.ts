import { RuntimeError } from '@banzae/agent-runtime-core';
import type { RuntimeProbe } from './types.js';

export class RuntimeProbeRegistry {
  private readonly probes = new Map<string, RuntimeProbe>();

  constructor(probes: readonly RuntimeProbe[] = []) {
    for (const probe of probes) this.register(probe);
  }

  register(probe: RuntimeProbe): void {
    if (this.probes.has(probe.adapterId)) {
      throw new RuntimeError({
        code: 'INVALID_CONFIGURATION',
        retryable: false,
        message: `Duplicate runtime probe ${probe.adapterId}`,
        adapterId: 'detection',
      });
    }
    this.probes.set(probe.adapterId, probe);
  }

  get(adapterId: string): RuntimeProbe | undefined {
    return this.probes.get(adapterId);
  }

  require(adapterId: string): RuntimeProbe {
    const probe = this.get(adapterId);
    if (!probe) {
      throw new RuntimeError({
        code: 'DETECTION_FAILED',
        retryable: false,
        message: `No runtime probe is registered for ${adapterId}`,
        adapterId: 'detection',
        details: { adapterId },
      });
    }
    return probe;
  }

  list(): RuntimeProbe[] {
    return [...this.probes.values()].sort((a, b) => a.adapterId.localeCompare(b.adapterId));
  }

  adapterIds(): string[] {
    return this.list().map((probe) => probe.adapterId);
  }
}
