import type {
  RuntimeHttpRequest,
  RuntimeHttpResponse,
  RuntimeSecret,
  RuntimeWebSocketEvent,
} from './types.js';

export interface RuntimeSecretStore {
  get(ref: string): Promise<RuntimeSecret | null>;
  set?(ref: string, value: RuntimeSecret): Promise<void>;
}

export interface RuntimeStateStore {
  get<T>(namespace: string, key: string): Promise<T | null>;
  set<T>(namespace: string, key: string, value: T): Promise<void>;
  delete(namespace: string, key: string): Promise<void>;
}

export interface RuntimeLogger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface RuntimeClock {
  now(): Date;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export interface RuntimeIdGenerator {
  id(): string;
}

export interface RuntimeHttpTransport {
  request(input: RuntimeHttpRequest): Promise<RuntimeHttpResponse>;
}

export interface RuntimeWebSocketConnection {
  send(data: string | Uint8Array): Promise<void>;
  events(): AsyncIterable<RuntimeWebSocketEvent>;
  close(code?: number, reason?: string): Promise<void>;
}

export interface RuntimeWebSocketFactory {
  connect(input: {
    url: string;
    headers?: Readonly<Record<string, string>>;
    signal?: AbortSignal;
    maxPayloadBytes?: number;
  }): Promise<RuntimeWebSocketConnection>;
}

export interface RuntimeCrypto {
  randomBytes(size: number): Uint8Array;
  sha256(input: string | Uint8Array): Promise<Uint8Array>;
  /**
   * Ed25519 keys are encoded as SPKI DER for public keys and PKCS8 DER for
   * private keys. Adapters that need raw public keys should derive them from
   * the SPKI envelope.
   */
  generateEd25519KeyPair(): Promise<{
    publicKey: Uint8Array;
    privateKey: Uint8Array;
  }>;
  signEd25519(privateKey: Uint8Array, message: Uint8Array): Promise<Uint8Array>;
}

export interface RuntimeLockManager {
  withLock<T>(
    key: string,
    options: { ttlMs: number; signal?: AbortSignal },
    work: () => Promise<T>,
  ): Promise<T>;
}

export type RuntimeAdapterDependencies = {
  secrets: RuntimeSecretStore;
  state: RuntimeStateStore;
  logger: RuntimeLogger;
  clock: RuntimeClock;
  ids: RuntimeIdGenerator;
  http: RuntimeHttpTransport;
  webSockets: RuntimeWebSocketFactory;
  crypto: RuntimeCrypto;
  locks?: RuntimeLockManager;
};
