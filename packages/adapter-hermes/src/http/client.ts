import {
  RuntimeError,
  collectBytes,
  readJsonBody,
  type RuntimeHttpTransport,
} from '@banzae/agent-runtime-core';

export type HermesHttpClientOptions = {
  baseUrl: string;
  bearerToken?: string;
  requestTimeoutMs?: number;
};

export class HermesHttpClient {
  private readonly baseUrl: string;

  constructor(
    private readonly transport: RuntimeHttpTransport,
    private readonly options: HermesHttpClientOptions,
  ) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
  }

  async json<T>(
    method: 'GET' | 'POST',
    path: string,
    input?: {
      body?: unknown;
      idempotencyKey?: string;
      headers?: Record<string, string>;
      signal?: AbortSignal;
    },
  ): Promise<{ value: T; headers: Readonly<Record<string, string>>; status: number }> {
    const response = await this.transport.request({
      url: `${this.baseUrl}${path}`,
      method,
      headers: this.headers(input),
      body: input?.body === undefined ? undefined : JSON.stringify(input.body),
      signal: input?.signal,
    });
    if (response.status >= 400) {
      const text = new TextDecoder().decode(await collectBytes(response.body, 64_000));
      throw new RuntimeError({
        code: response.status === 401 ? 'AUTHENTICATION_FAILED' : response.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_ERROR',
        retryable: response.status === 429 || response.status >= 500,
        message: `Hermes HTTP ${response.status}`,
        adapterId: 'hermes',
        retryAfterMs: retryAfterMs(response.headers),
        details: { status: response.status, response: text.slice(0, 500) },
      });
    }
    return {
      value: (await readJsonBody(response.body)) as T,
      headers: response.headers,
      status: response.status,
    };
  }

  async stream(path: string, input?: { headers?: Record<string, string>; signal?: AbortSignal }) {
    const response = await this.transport.request({
      url: `${this.baseUrl}${path}`,
      method: 'GET',
      headers: this.headers({ ...input, headers: { Accept: 'text/event-stream', ...input?.headers } }),
      signal: input?.signal,
    });
    if (response.status >= 400) {
      throw new RuntimeError({
        code: response.status === 404 ? 'PROVIDER_ERROR' : 'RUNTIME_UNAVAILABLE',
        retryable: response.status >= 500,
        message: `Hermes SSE HTTP ${response.status}`,
        adapterId: 'hermes',
      });
    }
    return response.body;
  }

  private headers(input?: { idempotencyKey?: string; headers?: Record<string, string> }): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...input?.headers,
    };
    if (this.options.bearerToken) headers.Authorization = `Bearer ${this.options.bearerToken}`;
    if (input?.idempotencyKey) headers['Idempotency-Key'] = input.idempotencyKey;
    return headers;
  }
}

function retryAfterMs(headers: Readonly<Record<string, string>>): number | undefined {
  const value = headers['retry-after'] ?? headers['Retry-After'];
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}
