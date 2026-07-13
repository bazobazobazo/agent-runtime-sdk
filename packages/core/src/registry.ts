import type { AgentRuntimeAdapter, RuntimeAdapterFactory } from './adapter.js';
import type { RuntimeAdapterDependencies } from './ports.js';
import { invalidConfiguration } from './errors.js';

export class RuntimeRegistry {
  private readonly factories = new Map<string, RuntimeAdapterFactory>();

  constructor(readonly dependencies: RuntimeAdapterDependencies) {}

  register(factory: RuntimeAdapterFactory): void {
    if (this.factories.has(factory.adapterId)) {
      throw invalidConfiguration(`Duplicate runtime adapter: ${factory.adapterId}`, {
        adapterId: factory.adapterId,
      });
    }
    this.factories.set(factory.adapterId, factory);
  }

  get(adapterId: string): RuntimeAdapterFactory {
    const factory = this.factories.get(adapterId);
    if (!factory) {
      throw invalidConfiguration(`Unknown runtime adapter: ${adapterId}`, { adapterId });
    }
    return factory;
  }

  list(): RuntimeAdapterFactory[] {
    return [...this.factories.values()];
  }

  create(adapterId: string): AgentRuntimeAdapter {
    return this.get(adapterId).create(this.dependencies);
  }
}
