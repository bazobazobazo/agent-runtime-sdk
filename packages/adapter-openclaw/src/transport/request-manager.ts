import { RuntimeError, type RuntimeWebSocketConnection } from '@banzae/agent-runtime-core';
import type { OpenClawFrame, OpenClawProtocolCodec, OpenClawRpcRequest } from '../protocol/types.js';

export type OpenClawEventFilter = {
  event?: string;
  events?: readonly string[];
};

export type OpenClawRequestManagerOptions = {
  requestTimeoutMs: number;
  maxFrameBytes?: number;
  subscriberQueueSize?: number;
};

type PendingRequest = {
  resolve: (frame: Extract<OpenClawFrame, { type: 'res' }>) => void;
  reject: (error: RuntimeError) => void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abort?: () => void;
};

type RunSubscriber = {
  id: string;
  filter?: OpenClawEventFilter;
  queue: Array<Extract<OpenClawFrame, { type: 'event' }>>;
  notify?: () => void;
  error?: RuntimeError;
  closed: boolean;
};

const DEFAULT_MAX_FRAME_BYTES = 1_000_000;
const DEFAULT_SUBSCRIBER_QUEUE_SIZE = 256;

export class OpenClawRequestManager {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly subscribers = new Map<string, RunSubscriber>();
  private readonly maxFrameBytes: number;
  private readonly subscriberQueueSize: number;
  private readLoop?: Promise<void>;
  private closePromise?: Promise<void>;
  private closedError?: RuntimeError;
  private subscriberSequence = 0;

  constructor(
    private readonly connection: RuntimeWebSocketConnection,
    private readonly codec: OpenClawProtocolCodec,
    options: number | OpenClawRequestManagerOptions,
  ) {
    this.options = typeof options === 'number' ? { requestTimeoutMs: options } : options;
    this.maxFrameBytes = this.options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
    this.subscriberQueueSize = this.options.subscriberQueueSize ?? DEFAULT_SUBSCRIBER_QUEUE_SIZE;
  }

  private readonly options: OpenClawRequestManagerOptions;

  private get pendingRequestCount(): number {
    return this.pending.size;
  }

  private get subscriberCount(): number {
    return this.subscribers.size;
  }

  async start(): Promise<void> {
    if (this.readLoop) return;
    this.readLoop = this.readEvents();
    this.readLoop.catch((error) => {
      this.failAll(toOpenClawRuntimeError(error, 'OpenClaw WebSocket read loop failed'));
    });
  }

  async request<T = unknown>(request: OpenClawRpcRequest, signal?: AbortSignal): Promise<T>;
  async request<T = unknown>(request: OpenClawRpcRequest, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<T>;
  async request<T = unknown>(request: OpenClawRpcRequest, optionsOrSignal?: AbortSignal | { signal?: AbortSignal; timeoutMs?: number }): Promise<T> {
    const options = optionsOrSignal instanceof AbortSignal ? { signal: optionsOrSignal } : optionsOrSignal;
    await this.start();
    if (this.closedError) throw this.closedError;
    if (this.pending.has(request.id)) {
      throw new RuntimeError({
        code: 'INVALID_REQUEST',
        retryable: false,
        adapterId: 'openclaw',
        message: `Duplicate OpenClaw request id ${request.id}`,
      });
    }
    if (options?.signal?.aborted) throw cancelledError();

    let settled = false;
    const responsePromise = new Promise<Extract<OpenClawFrame, { type: 'res' }>>((resolve, reject) => {
      const timeoutMs = options?.timeoutMs ?? this.options.requestTimeoutMs;
      const pending: PendingRequest = {
        resolve: (frame) => {
          if (settled) return;
          settled = true;
          this.cleanupPending(request.id);
          resolve(frame);
        },
        reject: (error) => {
          if (settled) return;
          settled = true;
          this.cleanupPending(request.id);
          reject(error);
        },
        timer: setTimeout(() => {
          pending.reject(
            new RuntimeError({
              code: 'TIMEOUT',
              retryable: true,
              adapterId: 'openclaw',
              message: `OpenClaw request timed out after ${timeoutMs}ms`,
              details: { requestId: request.id, method: request.method },
            }),
          );
        }, timeoutMs),
      };
      if (options?.signal) {
        pending.signal = options.signal;
        pending.abort = () => pending.reject(cancelledError());
        options.signal.addEventListener('abort', pending.abort, { once: true });
      }
      this.pending.set(request.id, pending);
    });

    try {
      await this.connection.send(this.codec.encodeRequest(request));
    } catch (error) {
      const pending = this.pending.get(request.id);
      pending?.reject(toOpenClawRuntimeError(error, 'OpenClaw WebSocket send failed'));
    }

    const response = await responsePromise;
    if ('error' in response && response.error) {
      throw this.codec.mapError(response.error);
    }
    return response.payload as T;
  }

  subscribe(filter?: OpenClawEventFilter): AsyncIterable<Extract<OpenClawFrame, { type: 'event' }>> {
    const id = `subscriber-${++this.subscriberSequence}`;
    const subscriber: RunSubscriber = { id, filter, queue: [], closed: false };
    this.subscribers.set(id, subscriber);
    void this.start();

    const owner = this;
    const iterator: AsyncIterableIterator<Extract<OpenClawFrame, { type: 'event' }>> = {
      [Symbol.asyncIterator]() {
        return iterator;
      },
      async next() {
        while (true) {
          const frame = subscriber.queue.shift();
          if (frame) {
            return { value: frame, done: false };
          }
          if (subscriber.error) throw subscriber.error;
          if (subscriber.closed) return { value: undefined, done: true };
          await new Promise<void>((resolve) => {
            subscriber.notify = resolve;
          });
          subscriber.notify = undefined;
        }
        return { value: undefined, done: true };
      },
      async return() {
        owner.removeSubscriber(id);
        return { value: undefined, done: true };
      },
    };

    return iterator;
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    const error = new RuntimeError({
      code: 'NETWORK',
      retryable: true,
      adapterId: 'openclaw',
      message: 'OpenClaw WebSocket dispatcher closed',
    });
    this.closedError = this.closedError ?? error;
    this.failAll(this.closedError);
    this.closePromise = this.connection.close().catch(() => undefined);
    await this.closePromise;
  }

  private async readEvents(): Promise<void> {
    try {
      for await (const event of this.connection.events()) {
        if (event.type === 'open') continue;
        if (event.type === 'message') {
          this.handleMessage(event.data);
          continue;
        }
        if (event.type === 'error') {
          this.failAll(
            new RuntimeError({
              code: 'NETWORK',
              retryable: true,
              adapterId: 'openclaw',
              message: 'OpenClaw WebSocket error',
              cause: event.error,
            }),
          );
          continue;
        }
        if (event.type === 'close') {
          this.failAll(
            new RuntimeError({
              code: 'NETWORK',
              retryable: true,
              adapterId: 'openclaw',
              message: 'OpenClaw WebSocket closed',
              details: { code: event.code, reason: event.reason },
            }),
          );
          return;
        }
      }
      this.failAll(
        new RuntimeError({
          code: 'NETWORK',
          retryable: true,
          adapterId: 'openclaw',
          message: 'OpenClaw WebSocket event stream ended',
        }),
      );
    } catch (error) {
      this.failAll(toOpenClawRuntimeError(error, 'OpenClaw WebSocket read loop failed'));
    }
  }

  private handleMessage(data: string | Uint8Array): void {
    const size = frameByteLength(data);
    if (size > this.maxFrameBytes) {
      const error = new RuntimeError({
        code: 'PROVIDER_ERROR',
        retryable: false,
        adapterId: 'openclaw',
        message: `OpenClaw frame exceeded ${this.maxFrameBytes} bytes`,
        details: { maxFrameBytes: this.maxFrameBytes, receivedBytes: size },
      });
      this.failAll(error);
      void this.close();
      return;
    }

    let frame: OpenClawFrame;
    try {
      frame = this.codec.parseFrame(data);
    } catch (error) {
      this.failAll(toOpenClawRuntimeError(error, 'OpenClaw frame parsing failed'));
      void this.close();
      return;
    }

    if (frame.type === 'res') {
      const pending = this.pending.get(frame.id);
      pending?.resolve(frame);
      return;
    }

    if (frame.type === 'event') {
      this.publishEvent(frame);
    }
  }

  private publishEvent(frame: Extract<OpenClawFrame, { type: 'event' }>): void {
    for (const subscriber of this.subscribers.values()) {
      if (!matchesFilter(frame, subscriber.filter)) continue;
      if (subscriber.queue.length >= this.subscriberQueueSize) {
        subscriber.error = new RuntimeError({
          code: 'PROVIDER_ERROR',
          retryable: false,
          adapterId: 'openclaw',
          message: `OpenClaw event subscriber queue exceeded ${this.subscriberQueueSize} frames`,
          details: { queueSize: this.subscriberQueueSize },
        });
        subscriber.closed = true;
        subscriber.notify?.();
        continue;
      }
      subscriber.queue.push(frame);
      subscriber.notify?.();
    }
  }

  private failAll(error: RuntimeError): void {
    this.closedError = this.closedError ?? error;
    for (const [id, pending] of [...this.pending.entries()]) {
      pending.reject(error);
      this.cleanupPending(id);
    }
    for (const subscriber of this.subscribers.values()) {
      subscriber.error = error;
      subscriber.closed = true;
      subscriber.notify?.();
    }
  }

  private cleanupPending(id: string): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    if (pending.signal && pending.abort) pending.signal.removeEventListener('abort', pending.abort);
    this.pending.delete(id);
  }

  private removeSubscriber(id: string): void {
    const subscriber = this.subscribers.get(id);
    if (!subscriber) return;
    subscriber.closed = true;
    subscriber.queue.length = 0;
    subscriber.notify?.();
    this.subscribers.delete(id);
  }
}

function matchesFilter(frame: Extract<OpenClawFrame, { type: 'event' }>, filter?: OpenClawEventFilter): boolean {
  if (!filter) return true;
  if (filter.event && frame.event !== filter.event) return false;
  if (filter.events && !filter.events.includes(frame.event)) return false;
  return true;
}

function frameByteLength(data: string | Uint8Array): number {
  return typeof data === 'string' ? new TextEncoder().encode(data).byteLength : data.byteLength;
}

function cancelledError(): RuntimeError {
  return new RuntimeError({
    code: 'CANCELLED',
    retryable: false,
    adapterId: 'openclaw',
    message: 'OpenClaw request was aborted',
  });
}

function toOpenClawRuntimeError(error: unknown, message: string): RuntimeError {
  if (error instanceof RuntimeError) return error;
  return new RuntimeError({
    code: 'NETWORK',
    retryable: true,
    adapterId: 'openclaw',
    message,
    cause: error,
  });
}
