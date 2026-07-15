import WebSocket from 'ws';
import {
  RuntimeError,
  resolveSecureLimit,
  type RuntimeWebSocketConnection,
  type RuntimeWebSocketEvent,
  type RuntimeWebSocketFactory,
  type RuntimeHttpRequest,
  type RuntimeHttpResponse,
  type RuntimeHttpTransport,
} from '@banzae/agent-runtime-core';
const CREDENTIAL_QUERY_KEYS = new Set(['token', 'access_token', 'api_key', 'password', 'secret', 'authorization', 'device_token']);

/** Public alpha contract for fetch http transport. */
export class FetchHttpTransport implements RuntimeHttpTransport {
  async request(input: RuntimeHttpRequest): Promise<RuntimeHttpResponse> {
    validateTransportUrl(input.url, new Set(['http:', 'https:']));
    const response = await fetch(input.url, {
      method: input.method,
      headers: input.headers,
      body: input.body instanceof Uint8Array ? Buffer.from(input.body) : input.body,
      signal: input.signal,
      redirect: 'manual',
    });
    const headers = Object.fromEntries(response.headers.entries());
    async function* body(): AsyncIterable<Uint8Array> {
      if (!response.body) return;
      const reader = response.body.getReader();
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) return;
          yield next.value;
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    }
    return { status: response.status, headers, body: body() };
  }
}

/** Public alpha contract for ws web socket factory. */
export class WsWebSocketFactory implements RuntimeWebSocketFactory {
  async connect(input: {
    url: string;
    headers?: Readonly<Record<string, string>>;
    signal?: AbortSignal;
    maxPayloadBytes?: number;
  }): Promise<RuntimeWebSocketConnection> {
    validateTransportUrl(input.url, new Set(['ws:', 'wss:']));
    const maxPayload = resolveSecureLimit('maxWebSocketFrameBytes', input.maxPayloadBytes);
    const ws = new WebSocket(input.url, { headers: input.headers, maxPayload });
    const cancelled = () => new RuntimeError({ code: 'CANCELLED', retryable: false, message: 'WebSocket connection was cancelled' });
    const onAbort = () => ws.close(4000, 'aborted');
    input.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      await new Promise<void>((resolve, reject) => {
        const opened = () => { cleanup(); resolve(); };
        const failed = (error: Error) => { cleanup(); reject(error); };
        const aborted = () => { cleanup(); reject(cancelled()); };
        const cleanup = () => {
          ws.off('open', opened);
          ws.off('error', failed);
          input.signal?.removeEventListener('abort', aborted);
        };
        ws.once('open', opened);
        ws.once('error', failed);
        input.signal?.addEventListener('abort', aborted, { once: true });
        if (input.signal?.aborted) aborted();
      });
    } catch (error) {
      input.signal?.removeEventListener('abort', onAbort);
      ws.terminate();
      throw error;
    }
    return new WsConnection(ws, () => input.signal?.removeEventListener('abort', onAbort));
  }
}

class WsConnection implements RuntimeWebSocketConnection {
  private readonly queueLimit = resolveSecureLimit('maxEventSubscriberQueue');
  constructor(private readonly ws: WebSocket, private readonly cleanupAbort: () => void) {}

  async send(data: string | Uint8Array): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.ws.send(data, (error) => (error ? reject(error) : resolve()));
    });
  }

  async *events(): AsyncIterable<RuntimeWebSocketEvent> {
    const queue: RuntimeWebSocketEvent[] = [];
    let notify: (() => void) | undefined;
    const push = (event: RuntimeWebSocketEvent) => {
      if (queue.length >= this.queueLimit) {
        queue.length = 0;
        queue.push({ type: 'error', error: new RuntimeError({ code: 'INVALID_RESPONSE', retryable: false, message: 'WebSocket event queue exceeded its maximum size' }) });
        this.ws.close(1009, 'queue limit exceeded');
        notify?.();
        notify = undefined;
        return;
      }
      queue.push(event);
      notify?.();
      notify = undefined;
    };
    const onMessage = (data: WebSocket.RawData) =>
      push({ type: 'message', data: typeof data === 'string' ? data : new Uint8Array(data as Buffer) });
    const onError = (error: Error) => push({ type: 'error', error });
    const onClose = (code: number) => push({ type: 'close', code });

    this.ws.on('message', onMessage);
    this.ws.on('error', onError);
    this.ws.on('close', onClose);
    try {
      push({ type: 'open' });
      while (this.ws.readyState === WebSocket.OPEN || queue.length > 0) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            notify = resolve;
          });
        }
        const event = queue.shift();
        if (event) yield event;
        if (event?.type === 'close') return;
      }
    } finally {
      this.ws.off('message', onMessage);
      this.ws.off('error', onError);
      this.ws.off('close', onClose);
      notify?.();
      this.cleanupAbort();
    }
  }

  async close(code?: number, reason?: string): Promise<void> {
    this.cleanupAbort();
    if (this.ws.readyState === WebSocket.CLOSED) return;
    if (this.ws.readyState === WebSocket.CLOSING) {
      await new Promise<void>((resolve) => this.ws.once('close', () => resolve()));
      return;
    }
    await new Promise<void>((resolve) => {
      this.ws.once('close', () => resolve());
      this.ws.close(code, reason);
    });
  }
}

function validateTransportUrl(input: string, allowedSchemes: ReadonlySet<string>): URL {
  let url: URL;
  try { url = new URL(input); } catch {
    throw new RuntimeError({ code: 'NETWORK_POLICY_REJECTED', retryable: false, message: 'Runtime transport URL is invalid', operation: 'network-policy.validate' });
  }
  if (!allowedSchemes.has(url.protocol) || !url.hostname || url.username || url.password) {
    throw new RuntimeError({ code: 'NETWORK_POLICY_REJECTED', retryable: false, message: 'Runtime transport URL violates network policy', operation: 'network-policy.validate' });
  }
  for (const key of url.searchParams.keys()) {
    if (CREDENTIAL_QUERY_KEYS.has(key.toLowerCase())) {
      throw new RuntimeError({ code: 'NETWORK_POLICY_REJECTED', retryable: false, message: 'Runtime transport URL contains credential-like query data', operation: 'network-policy.validate' });
    }
  }
  return url;
}
