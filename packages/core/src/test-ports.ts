import type {
  RuntimeAdapterDependencies,
  RuntimeClock,
  RuntimeCrypto,
  RuntimeHttpTransport,
  RuntimeIdGenerator,
  RuntimeLogger,
  RuntimeSecretStore,
  RuntimeStateStore,
  RuntimeWebSocketFactory,
} from './ports.js';
import type { RuntimeHttpRequest, RuntimeSecret } from './types.js';
import { RuntimeError } from './errors.js';

export class MemoryStateStore implements RuntimeStateStore {
  private readonly values = new Map<string, unknown>();

  async get<T>(namespace: string, key: string): Promise<T | null> {
    return (this.values.get(`${namespace}:${key}`) as T | undefined) ?? null;
  }

  async set<T>(namespace: string, key: string, value: T): Promise<void> {
    this.values.set(`${namespace}:${key}`, value);
  }

  async delete(namespace: string, key: string): Promise<void> {
    this.values.delete(`${namespace}:${key}`);
  }
}

export class MemorySecretStore implements RuntimeSecretStore {
  private readonly values = new Map<string, RuntimeSecret>();

  async get(ref: string): Promise<RuntimeSecret | null> {
    return this.values.get(ref) ?? null;
  }

  async set(ref: string, value: RuntimeSecret): Promise<void> {
    this.values.set(ref, value);
  }
}

export const noopLogger: RuntimeLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

export const systemClock: RuntimeClock = {
  now: () => new Date(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new RuntimeError({ code: 'CANCELLED', retryable: false, message: 'Sleep aborted' }));
        return;
      }
      const timeout = setTimeout(resolve, ms);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timeout);
          reject(new RuntimeError({ code: 'CANCELLED', retryable: false, message: 'Sleep aborted' }));
        },
        { once: true },
      );
    }),
};

export class IncrementingIdGenerator implements RuntimeIdGenerator {
  private value = 0;

  id(): string {
    this.value += 1;
    return `id-${this.value}`;
  }
}

export const unavailableHttpTransport: RuntimeHttpTransport = {
  async request(input: RuntimeHttpRequest) {
    throw new RuntimeError({
      code: 'PROVIDER_UNAVAILABLE',
      retryable: true,
      message: 'No RuntimeHttpTransport configured',
      details: { url: input.url, method: input.method },
    });
  },
};

export const unavailableWebSocketFactory: RuntimeWebSocketFactory = {
  async connect() {
    throw new RuntimeError({
      code: 'PROVIDER_UNAVAILABLE',
      retryable: true,
      message: 'No RuntimeWebSocketFactory configured',
    });
  },
};

export const deterministicCrypto: RuntimeCrypto = {
  randomBytes(size) {
    return new Uint8Array(size).fill(7);
  },
  async sha256(input) {
    const text = typeof input === 'string' ? input : [...input].join(',');
    let hash = 2166136261;
    for (const char of text) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    const bytes = new Uint8Array(32);
    new DataView(bytes.buffer).setUint32(0, hash >>> 0);
    return bytes;
  },
  async generateEd25519KeyPair() {
    return { publicKey: new Uint8Array([1, 2, 3]), privateKey: new Uint8Array([4, 5, 6]) };
  },
  async signEd25519(_privateKey, message) {
    return new Uint8Array(message).reverse();
  },
};

export function createTestDependencies(
  overrides: Partial<RuntimeAdapterDependencies> = {},
): RuntimeAdapterDependencies {
  return {
    secrets: new MemorySecretStore(),
    state: new MemoryStateStore(),
    logger: noopLogger,
    clock: systemClock,
    ids: new IncrementingIdGenerator(),
    http: unavailableHttpTransport,
    webSockets: unavailableWebSocketFactory,
    crypto: deterministicCrypto,
    ...overrides,
  };
}
