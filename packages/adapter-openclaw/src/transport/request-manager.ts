import {
  RuntimeError,
  resolveSecureLimit,
  type RuntimeWebSocketConnection,
} from '@banzae/agent-runtime-core';
import type { OpenClawFrame, OpenClawProtocolCodec, OpenClawRpcRequest } from '../protocol/types.js';

export type OpenClawEventFilter = {
  event?: string;
  events?: readonly string[];
  /** Internal replay cursor captured before a run request is sent. */
  afterCursor?: number;
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

type BufferedEvent = {
  cursor: number;
  frame: Extract<OpenClawFrame, { type: 'event' }>;
};

export class OpenClawRequestManager {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly subscribers = new Map<string, RunSubscriber>();
  private readonly maxFrameBytes: number;
  private readonly subscriberQueueSize: number;
  private readLoop?: Promise<void>;
  private closePromise?: Promise<void>;
  private closedError?: RuntimeError;
  private subscriberSequence = 0;
  private eventSequence = 0;
  private readonly recentEvents: BufferedEvent[] = [];

  constructor(
    private readonly connection: RuntimeWebSocketConnection,
    private readonly codec: OpenClawProtocolCodec,
    options: number | OpenClawRequestManagerOptions,
  ) {
    this.options = typeof options === 'number' ? { requestTimeoutMs: options } : options;
    this.maxFrameBytes = resolveSecureLimit('maxWebSocketFrameBytes', this.options.maxFrameBytes);
    this.subscriberQueueSize = resolveSecureLimit('maxEventSubscriberQueue', this.options.subscriberQueueSize);
    validateRequestTimeout(this.options.requestTimeoutMs);
  }

  /** Internal test instrumentation; not part of the exported package surface. */
  private get pendingRequestCount(): number {
    return this.pending.size;
  }

  /** Internal test instrumentation; not part of the exported package surface. */
  private get subscriberCount(): number {
    return this.subscribers.size;
  }

  private readonly options: OpenClawRequestManagerOptions;

  /** Internal adapter liveness signal; not part of the package public API. */
  get isClosed(): boolean {
    return this.closedError != null;
  }

  /** Internal cursor used to replay events emitted while a run-start request is in flight. */
  eventCursor(): number {
    return this.eventSequence;
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
    const timeoutMs = validateRequestTimeout(options?.timeoutMs ?? this.options.requestTimeoutMs);
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
    if (options?.signal?.aborted) throw abortSignalError(options.signal);

    let settled = false;
    const responsePromise = new Promise<Extract<OpenClawFrame, { type: 'res' }>>((resolve, reject) => {
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
          const error = new RuntimeError({
            code: 'TIMEOUT',
            retryable: true,
            adapterId: 'openclaw',
            message: `OpenClaw request timed out after ${timeoutMs}ms`,
            details: { requestId: request.id, method: request.method },
          });
          this.failAll(error);
          void this.close().catch(() => undefined);
        }, timeoutMs),
      };
      if (options?.signal) {
        const signal = options.signal;
        pending.signal = signal;
        pending.abort = () => {
          const error = abortSignalError(signal);
          // A provider response may still arrive after local cancellation. Close
          // the dispatcher so that a deterministic request id cannot be reused
          // on this socket and accidentally consume that late response.
          this.failAll(error);
          void this.close().catch(() => undefined);
        };
        signal.addEventListener('abort', pending.abort, { once: true });
      }
      this.pending.set(request.id, pending);
      if (pending.signal?.aborted) pending.abort?.();
    });

    void this.connection.send(this.codec.encodeRequest(request)).catch((error: unknown) => {
      const mapped = toOpenClawRuntimeError(error, 'OpenClaw WebSocket send failed');
      this.failAll(mapped);
      void this.close().catch(() => undefined);
    });

    const response = await responsePromise;
    if ('error' in response && response.error) {
      throw this.codec.mapError(response.error);
    }
    return response.payload as T;
  }

  subscribe(filter?: OpenClawEventFilter): AsyncIterable<Extract<OpenClawFrame, { type: 'event' }>> {
    const id = `subscriber-${++this.subscriberSequence}`;
    const subscriber: RunSubscriber = { id, filter, queue: [], closed: false };
    if (this.closedError) {
      subscriber.error = this.closedError;
      subscriber.closed = true;
    } else if (filter?.afterCursor !== undefined) {
      const oldestCursor = this.recentEvents[0]?.cursor;
      if (oldestCursor !== undefined && filter.afterCursor < oldestCursor - 1) {
        subscriber.error = new RuntimeError({
          code: 'OUTCOME_UNKNOWN',
          retryable: false,
          adapterId: 'openclaw',
          message: 'OpenClaw event replay window was exceeded',
          details: { replayCapacity: this.subscriberQueueSize },
        });
        subscriber.closed = true;
      } else {
        subscriber.queue.push(
          ...this.recentEvents
            .filter((entry) => entry.cursor > filter.afterCursor! && matchesFilter(entry.frame, filter))
            .map((entry) => entry.frame),
        );
      }
    }
    if (!subscriber.closed) {
      this.subscribers.set(id, subscriber);
      void this.start();
    }

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

  async close(options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<void> {
    if (this.closePromise) {
      if (options) {
        await boundedConnectionClose(this.connection, options);
        return;
      }
      return this.closePromise;
    }
    const error = new RuntimeError({
      code: 'NETWORK',
      retryable: true,
      adapterId: 'openclaw',
      message: 'OpenClaw WebSocket dispatcher closed',
    });
    this.closedError = this.closedError ?? error;
    this.failAll(this.closedError);
    this.closePromise = boundedConnectionClose(this.connection, options);
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
              details: { code: event.code },
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
        code: 'INVALID_RESPONSE',
        retryable: false,
        adapterId: 'openclaw',
        message: `OpenClaw frame exceeded ${this.maxFrameBytes} bytes`,
        details: { maxFrameBytes: this.maxFrameBytes, receivedBytes: size },
      });
      this.failAll(error);
      void this.close().catch(() => undefined);
      return;
    }

    let frame: OpenClawFrame;
    try {
      frame = this.codec.parseFrame(data);
    } catch (error) {
      this.failAll(toOpenClawRuntimeError(error, 'OpenClaw frame parsing failed'));
      void this.close().catch(() => undefined);
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
    this.recentEvents.push({ cursor: ++this.eventSequence, frame });
    if (this.recentEvents.length > this.subscriberQueueSize) this.recentEvents.shift();
    for (const subscriber of this.subscribers.values()) {
      if (!matchesFilter(frame, subscriber.filter)) continue;
      if (subscriber.queue.length >= this.subscriberQueueSize) {
        subscriber.error = new RuntimeError({
          code: 'INVALID_RESPONSE',
          retryable: false,
          adapterId: 'openclaw',
          message: `OpenClaw event subscriber queue exceeded ${this.subscriberQueueSize} frames`,
          details: { queueSize: this.subscriberQueueSize },
        });
        subscriber.closed = true;
        subscriber.queue.length = 0;
        subscriber.notify?.();
        this.subscribers.delete(subscriber.id);
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
    this.subscribers.clear();
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

function validateRequestTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 300_000) {
    throw new RuntimeError({
      code: 'INVALID_CONFIGURATION',
      retryable: false,
      adapterId: 'openclaw',
      message: 'OpenClaw request timeout is invalid',
    });
  }
  return value;
}

async function boundedConnectionClose(
  connection: RuntimeWebSocketConnection,
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<void> {
  const timeoutMs = Math.min(Math.max(1, options?.timeoutMs ?? 1_000), 1_000);
  const settled = await boundedCloseWait(
    connection.close(1000, 'dispatcher closed'),
    timeoutMs,
    options?.signal,
  );
  if (!settled) {
    if (!connection.terminate) {
      throw new RuntimeError({
        code: 'NETWORK',
        retryable: true,
        adapterId: 'openclaw',
        message: 'OpenClaw transport could not be terminated after dispatcher close timed out',
      });
    }
    await connection.terminate('dispatcher close timed out');
  }
}

async function boundedCloseWait(work: Promise<void>, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (completed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(completed);
    };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(false), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    work.then(() => finish(true), () => finish(false));
    if (signal?.aborted) onAbort();
  });
}

function frameByteLength(data: string | Uint8Array): number {
  return typeof data === 'string' ? new TextEncoder().encode(data).byteLength : data.byteLength;
}

function abortSignalError(signal: AbortSignal): RuntimeError {
  if (signal.reason instanceof RuntimeError) return signal.reason;
  return new RuntimeError({
    code: 'CANCELLED',
    retryable: false,
    adapterId: 'openclaw',
    message: 'OpenClaw request was aborted',
    cause: signal.reason,
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
