import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { RuntimeSecret, RuntimeSecretStore, RuntimeStateStore } from '@banzae/agent-runtime-core';

const MAX_SEGMENT_BYTES = 180;
const pendingMutations = new Map<string, Promise<void>>();

/** Public alpha contract for node file state store. */
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
    await serializeMutation(path, async () => {
      const serialized = JSON.stringify(value, null, 2);
      if (serialized === undefined) throw new TypeError('State value must be JSON serializable');
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const temporaryPath = `${path}.${randomUUID()}.tmp`;
      let file: Awaited<ReturnType<typeof open>> | undefined;
      try {
        file = await open(temporaryPath, 'wx', 0o600);
        await file.writeFile(`${serialized}\n`, 'utf8');
        await file.sync();
        await file.close();
        file = undefined;
        await rename(temporaryPath, path);
        await syncDirectory(dirname(path));
      } finally {
        try {
          await file?.close();
        } finally {
          await rm(temporaryPath, { force: true });
        }
      }
    });
  }

  async delete(namespace: string, key: string): Promise<void> {
    const path = this.path(namespace, key);
    await serializeMutation(path, async () => {
      await rm(path, { force: true });
      await syncDirectory(dirname(path), true);
    });
  }

  private path(namespace: string, key: string): string {
    return join(this.rootDir, stateSegment(namespace), `${stateSegment(key)}.json`);
  }
}

/** Public alpha contract for node memory secret store. */
export class NodeMemorySecretStore implements RuntimeSecretStore {
  private readonly values = new Map<string, RuntimeSecret>();

  async get(ref: string): Promise<RuntimeSecret | null> {
    return this.values.get(ref) ?? null;
  }

  async set(ref: string, value: RuntimeSecret): Promise<void> {
    this.values.set(ref, value);
  }
}

function stateSegment(value: string): string {
  if (typeof value !== 'string' || !value) {
    throw new RangeError('State namespace and key must be nonempty UTF-8 strings of at most 180 bytes');
  }
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length > MAX_SEGMENT_BYTES || bytes.toString('utf8') !== value) {
    throw new RangeError('State namespace and key must be nonempty UTF-8 strings of at most 180 bytes');
  }
  if (value !== '.' && value !== '..' && /^[a-zA-Z0-9_.-]+$/.test(value)) return value;
  return `~${bytes.toString('base64url')}`;
}

async function serializeMutation(path: string, operation: () => Promise<void>): Promise<void> {
  const key = resolve(path);
  const previous = pendingMutations.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  pendingMutations.set(key, current);
  try {
    await current;
  } finally {
    if (pendingMutations.get(key) === current) pendingMutations.delete(key);
  }
}

async function syncDirectory(path: string, allowMissing = false): Promise<void> {
  let directory: Awaited<ReturnType<typeof open>>;
  try {
    directory = await open(path, 'r');
  } catch (error) {
    if (allowMissing && (error as { code?: string } | null)?.code === 'ENOENT') return;
    if (directorySyncUnsupported(error)) return;
    throw error;
  }
  try {
    await directory.sync();
  } catch (error) {
    if (!directorySyncUnsupported(error)) throw error;
  } finally {
    await directory.close();
  }
}

function directorySyncUnsupported(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === 'EINVAL' || code === 'ENOTSUP' || code === 'EISDIR' || code === 'EPERM';
}
