import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { RuntimeSecret, RuntimeSecretStore, RuntimeStateStore } from '@banzae/agent-runtime-core';

export class NodeFileStateStore implements RuntimeStateStore {
  constructor(private readonly rootDir: string) {}

  async get<T>(namespace: string, key: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(this.path(namespace, key), 'utf8')) as T;
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return null;
      throw error;
    }
  }

  async set<T>(namespace: string, key: string, value: T): Promise<void> {
    const path = this.path(namespace, key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  }

  async delete(namespace: string, key: string): Promise<void> {
    await rm(this.path(namespace, key), { force: true });
  }

  private path(namespace: string, key: string): string {
    return join(this.rootDir, safeSegment(namespace), `${safeSegment(key)}.json`);
  }
}

export class NodeMemorySecretStore implements RuntimeSecretStore {
  private readonly values = new Map<string, RuntimeSecret>();

  async get(ref: string): Promise<RuntimeSecret | null> {
    return this.values.get(ref) ?? null;
  }

  async set(ref: string, value: RuntimeSecret): Promise<void> {
    this.values.set(ref, value);
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_');
}
