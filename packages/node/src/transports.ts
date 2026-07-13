import WebSocket from 'ws';
import type {
  RuntimeHttpRequest,
  RuntimeHttpResponse,
  RuntimeHttpTransport,
  RuntimeWebSocketConnection,
  RuntimeWebSocketEvent,
  RuntimeWebSocketFactory,
} from '@banzae/agent-runtime-core';

export class FetchHttpTransport implements RuntimeHttpTransport {
  async request(input: RuntimeHttpRequest): Promise<RuntimeHttpResponse> {
    const response = await fetch(input.url, {
      method: input.method,
      headers: input.headers,
      body: input.body instanceof Uint8Array ? Buffer.from(input.body) : input.body,
      signal: input.signal,
    });
    const headers = Object.fromEntries(response.headers.entries());
    async function* body(): AsyncIterable<Uint8Array> {
      if (!response.body) return;
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        yield chunk;
      }
    }
    return { status: response.status, headers, body: body() };
  }
}

export class WsWebSocketFactory implements RuntimeWebSocketFactory {
  async connect(input: {
    url: string;
    headers?: Readonly<Record<string, string>>;
    signal?: AbortSignal;
    maxPayloadBytes?: number;
  }): Promise<RuntimeWebSocketConnection> {
    const ws = new WebSocket(input.url, { headers: input.headers, maxPayload: input.maxPayloadBytes });
    if (input.signal) {
      input.signal.addEventListener('abort', () => ws.close(4000, 'aborted'), { once: true });
    }
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    return new WsConnection(ws);
  }
}

class WsConnection implements RuntimeWebSocketConnection {
  constructor(private readonly ws: WebSocket) {}

  async send(data: string | Uint8Array): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.ws.send(data, (error) => (error ? reject(error) : resolve()));
    });
  }

  async *events(): AsyncIterable<RuntimeWebSocketEvent> {
    const queue: RuntimeWebSocketEvent[] = [];
    let notify: (() => void) | undefined;
    const push = (event: RuntimeWebSocketEvent) => {
      queue.push(event);
      notify?.();
      notify = undefined;
    };
    const onMessage = (data: WebSocket.RawData) =>
      push({ type: 'message', data: typeof data === 'string' ? data : new Uint8Array(data as Buffer) });
    const onError = (error: Error) => push({ type: 'error', error });
    const onClose = (code: number, reason: Buffer) => push({ type: 'close', code, reason: reason.toString() });

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
    }
  }

  async close(code?: number, reason?: string): Promise<void> {
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
