import type { PersistedRuntimeDetection, RuntimeDetectionStore } from './types.js';

export class MemoryRuntimeDetectionStore implements RuntimeDetectionStore {
  private readonly values = new Map<string, PersistedRuntimeDetection>();

  async get(key: string): Promise<PersistedRuntimeDetection | undefined> {
    return this.values.get(key);
  }

  async set(key: string, value: PersistedRuntimeDetection): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}
