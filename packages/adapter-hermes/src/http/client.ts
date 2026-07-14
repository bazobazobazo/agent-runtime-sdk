import {
  RuntimeError,
  type RuntimeErrorCode,
  type RuntimeHttpResponse,
  type RuntimeHttpTransport,
} from '@banzae/agent-runtime-core';

export type HermesHttpClientOptions = {
  baseUrl: string;
  bearerToken?: string;
  requestTimeoutMs?: number;
  maxBodyBytes?: number;
  maxHeaderBytes?: number;
};

export type HermesHttpInput = {
  body?: unknown;
  idempotencyKey?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  allowEmpty?: boolean;
};

export class HermesHttpClient {
  private readonly baseUrl: URL;
  private closed = false;
  private readonly active = new Set<LinkedOperation>();

  constructor(
    private readonly transport: RuntimeHttpTransport,
    private readonly options: HermesHttpClientOptions,
  ) {
    this.baseUrl = new URL(options.baseUrl.replace(/\/$/, ''));
    if (this.baseUrl.protocol !== 'https:' && this.baseUrl.protocol !== 'http:') {
      throw runtimeError('INVALID_CONFIGURATION', 'Hermes endpoint must use HTTP or HTTPS', false);
    }
  }

  get hasCredentials(): boolean {
    return Boolean(this.options.bearerToken);
  }

  async json<T>(
    method: 'GET' | 'POST',
    path: string,
    input: HermesHttpInput = {},
  ): Promise<{ value: T; headers: Readonly<Record<string, string>>; status: number }> {
    this.assertOpen();
    const operation = linkedTimeout(input.signal, input.timeoutMs ?? this.options.requestTimeoutMs);
    this.active.add(operation);
    try {
      const response = await this.transport.request({
        url: this.url(path).toString(),
        method,
        headers: this.headers(input),
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        signal: operation.signal,
      });
      try {
        validateHeaderSize(response.headers, this.options.maxHeaderBytes ?? 32_000);
      } catch (error) {
        await closeBody(response.body);
        throw error;
      }
      if (isRedirect(response.status)) {
        await closeBody(response.body);
        throw this.httpError(response.status, 'Hermes redirects are not supported', false, response.headers, 'redirect');
      }
      if (response.status >= 400) {
        await closeBody(response.body);
        throw this.httpError(response.status, `Hermes HTTP ${response.status}`, retryableStatus(response.status), response.headers, 'http');
      }
      const bytes = await readBytes(response.body, this.options.maxBodyBytes ?? 1_000_000, operation.signal);
      if (bytes.byteLength === 0) {
        if (input.allowEmpty) return { value: undefined as T, headers: response.headers, status: response.status };
        throw runtimeError('PROVIDER_ERROR', 'Hermes returned an empty JSON response', false, { status: response.status, stage: 'http.json' });
      }
      const contentType = header(response.headers, 'content-type');
      if (!contentType || !contentType.toLowerCase().includes('application/json')) {
        throw runtimeError('PROVIDER_ERROR', 'Hermes returned a non-JSON response', false, { status: response.status, contentType, stage: 'http.json' });
      }
      try {
        return { value: JSON.parse(new TextDecoder().decode(bytes)) as T, headers: response.headers, status: response.status };
      } catch (error) {
        throw runtimeError('PROVIDER_ERROR', 'Hermes returned malformed JSON', false, safeErrorDetails(error, 'http.json'));
      }
    } catch (error) {
      throw normalizeTransportError(error, operation.signal);
    } finally {
      this.active.delete(operation);
      operation.cleanup();
    }
  }

  async stream(path: string, input: HermesHttpInput = {}): Promise<AsyncIterable<Uint8Array>> {
    this.assertOpen();
    const operation = linkedTimeout(input.signal, input.timeoutMs ?? this.options.requestTimeoutMs);
    this.active.add(operation);
    try {
      const response = await this.transport.request({
        url: this.url(path).toString(),
        method: 'GET',
        headers: this.headers({ ...input, headers: { Accept: 'text/event-stream', ...input.headers } }),
        signal: operation.signal,
      });
      try {
        validateHeaderSize(response.headers, this.options.maxHeaderBytes ?? 32_000);
      } catch (error) {
        await closeBody(response.body);
        throw error;
      }
      if (isRedirect(response.status)) {
        await closeBody(response.body);
        throw this.httpError(response.status, 'Hermes redirects are not supported', false, response.headers, 'redirect');
      }
      if (response.status >= 400) {
        await closeBody(response.body);
        throw this.httpError(response.status, `Hermes SSE HTTP ${response.status}`, retryableStatus(response.status), response.headers, 'sse');
      }
      const contentType = header(response.headers, 'content-type');
      if (!contentType || !contentType.toLowerCase().includes('text/event-stream')) {
        await closeBody(response.body);
        throw runtimeError('PROVIDER_ERROR', 'Hermes returned a non-SSE response', false, { status: response.status, contentType, stage: 'sse' });
      }
      return abortLinkedBody(response.body, operation, () => this.active.delete(operation));
    } catch (error) {
      this.active.delete(operation);
      operation.cleanup();
      throw normalizeTransportError(error, operation.signal);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const operation of this.active) operation.abort(runtimeError('CANCELLED', 'Hermes HTTP client is closed', false));
  }

  private assertOpen(): void {
    if (this.closed) throw runtimeError('CANCELLED', 'Hermes HTTP client is closed', false);
  }

  private url(path: string): URL {
    const url = new URL(path, `${this.baseUrl.toString()}/`);
    if (this.baseUrl.protocol === 'https:' && url.protocol === 'http:') {
      throw runtimeError('INVALID_CONFIGURATION', 'Hermes redirect would downgrade HTTPS to HTTP', false, { stage: 'url' });
    }
    if (url.host !== this.baseUrl.host) {
      throw runtimeError('INVALID_CONFIGURATION', 'Hermes request attempted to cross host boundary', false, { stage: 'url' });
    }
    return url;
  }

  private headers(input: HermesHttpInput): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...input.headers,
    };
    if (this.options.bearerToken) headers.Authorization = `Bearer ${this.options.bearerToken}`;
    if (input.idempotencyKey) headers['Idempotency-Key'] = input.idempotencyKey;
    return headers;
  }

  private httpError(status: number, message: string, retryable: boolean, headers: Readonly<Record<string, string>>, stage: string): RuntimeError {
    return new RuntimeError({
      code: mapStatus(status, this.hasCredentials),
      message,
      retryable,
      retryAfterMs: retryAfterMs(headers),
      adapterId: 'hermes',
      details: {
        status,
        retryAfterMs: retryAfterMs(headers),
        stage,
      },
    });
  }
}

function mapStatus(status: number, hasCredentials: boolean): RuntimeErrorCode {
  if (status === 400) return 'INVALID_REQUEST';
  if (status === 401) return hasCredentials ? 'AUTHENTICATION_FAILED' : 'AUTHENTICATION_REQUIRED';
  if (status === 403) return 'PERMISSION_DENIED';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'PROVIDER_UNAVAILABLE';
  if (isRedirect(status)) return 'PROVIDER_ERROR';
  return 'PROVIDER_ERROR';
}

function retryableStatus(status: number): boolean {
  return status === 429 || status === 503 || status >= 500;
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function retryAfterMs(headers: Readonly<Record<string, string>>): number | undefined {
  const value = header(headers, 'retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function header(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return found?.[1];
}

function validateHeaderSize(headers: Readonly<Record<string, string>>, maxBytes: number): void {
  const encoder = new TextEncoder();
  const size = Object.entries(headers).reduce((total, [key, value]) => total + encoder.encode(key).byteLength + encoder.encode(value).byteLength, 0);
  if (size > maxBytes) throw runtimeError('PROVIDER_ERROR', 'Hermes response headers exceeded maximum size', false, { maxBytes, stage: 'headers' });
}

async function readBytes(body: AsyncIterable<Uint8Array>, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const iterator = body[Symbol.asyncIterator]();
  let done = false;
  const onAbort = () => {
    void iterator.return?.();
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    while (true) {
      throwIfAborted(signal);
      const next = await iterator.next();
      if (next.done) {
        done = true;
        break;
      }
      size += next.value.byteLength;
      if (size > maxBytes) throw runtimeError('PROVIDER_ERROR', 'Hermes response body exceeded maximum size', false, { maxBytes, stage: 'body' });
      chunks.push(next.value);
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    if (!done) await iterator.return?.().catch(() => undefined);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function closeBody(body: AsyncIterable<Uint8Array>): Promise<void> {
  const iterator = body[Symbol.asyncIterator]();
  await iterator.return?.().catch(() => undefined);
}

function abortLinkedBody(body: AsyncIterable<Uint8Array>, operation: LinkedOperation, onDone: () => void): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      const iterator = body[Symbol.asyncIterator]();
      const onAbort = () => {
        void iterator.return?.();
      };
      operation.signal.addEventListener('abort', onAbort, { once: true });
      try {
        while (true) {
          throwIfAborted(operation.signal);
          const next = await iterator.next();
          if (next.done) return;
          yield next.value;
        }
      } finally {
        operation.signal.removeEventListener('abort', onAbort);
        await iterator.return?.().catch(() => undefined);
        onDone();
        operation.cleanup();
      }
    },
  };
}

type LinkedOperation = { signal: AbortSignal; abort: (reason: unknown) => void; cleanup: () => void };

function linkedTimeout(parent: AbortSignal | undefined, timeoutMs: number | undefined): LinkedOperation {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const onAbort = () => controller.abort(parent?.reason ?? runtimeError('CANCELLED', 'Hermes operation was cancelled', false));
  if (parent?.aborted) onAbort();
  else parent?.addEventListener('abort', onAbort, { once: true });
  if (timeoutMs && timeoutMs > 0) {
    timeout = setTimeout(() => {
      controller.abort(runtimeError('TIMEOUT', `Hermes operation timed out after ${timeoutMs}ms`, true, { timeoutMs }));
    }, timeoutMs);
  }
  return {
    signal: controller.signal,
    abort: (reason) => controller.abort(reason),
    cleanup: () => {
      if (timeout) clearTimeout(timeout);
      parent?.removeEventListener('abort', onAbort);
    },
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof RuntimeError ? signal.reason : runtimeError('CANCELLED', 'Hermes operation was cancelled', false);
}

function normalizeTransportError(error: unknown, signal: AbortSignal): RuntimeError {
  if (error instanceof RuntimeError) return error;
  if (signal.aborted) return signal.reason instanceof RuntimeError ? signal.reason : runtimeError('CANCELLED', 'Hermes operation was cancelled', false);
  return runtimeError('RUNTIME_UNAVAILABLE', 'Hermes transport failed', true, safeErrorDetails(error, 'transport'));
}

function runtimeError(code: RuntimeErrorCode, message: string, retryable: boolean, details?: Record<string, unknown>): RuntimeError {
  return new RuntimeError({ code, message, retryable, adapterId: 'hermes', details });
}

function safeErrorDetails(error: unknown, stage: string): Record<string, unknown> {
  const details: Record<string, unknown> = { stage };
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    if (typeof value.code === 'string') details.providerCode = value.code;
    if (typeof value.name === 'string') details.providerErrorName = value.name;
  }
  return details;
}
