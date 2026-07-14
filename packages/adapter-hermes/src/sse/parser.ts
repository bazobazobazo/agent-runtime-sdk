import { RuntimeError } from '@banzae/agent-runtime-core';

export type SseEvent = {
  id?: string;
  event?: string;
  data: string;
};

export type SseParserOptions = {
  signal?: AbortSignal;
  maxLineBytes?: number;
  maxEventBytes?: number;
  maxPendingBytes?: number;
};

export async function* parseSseStream(
  body: AsyncIterable<Uint8Array>,
  optionsOrMaxEventBytes: SseParserOptions | number = {},
): AsyncIterable<SseEvent> {
  const options = typeof optionsOrMaxEventBytes === 'number' ? { maxEventBytes: optionsOrMaxEventBytes } : optionsOrMaxEventBytes;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const iterator = body[Symbol.asyncIterator]();
  const maxLineBytes = options.maxLineBytes ?? 64_000;
  const maxEventBytes = options.maxEventBytes ?? 1_000_000;
  const maxPendingBytes = options.maxPendingBytes ?? 1_000_000;
  let buffer = '';
  let firstChunk = true;
  let eventId: string | undefined;
  let eventName: string | undefined;
  const dataLines: string[] = [];
  let eventBytes = 0;
  const onAbort = () => {
    void iterator.return?.();
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });

  const flush = function* (): Iterable<SseEvent> {
    if (dataLines.length === 0 && !eventName && !eventId) return;
    const event: SseEvent = { data: dataLines.join('\n') };
    if (eventId) event.id = eventId;
    if (eventName) event.event = eventName;
    eventId = undefined;
    eventName = undefined;
    dataLines.length = 0;
    eventBytes = 0;
    yield event;
  };

  try {
    while (true) {
      throwIfAborted(options.signal);
      const next = await iterator.next();
      if (next.done) break;
      let decoded: string;
      try {
        decoded = decoder.decode(next.value, { stream: true });
      } catch (error) {
        throw providerError('Hermes SSE stream contained malformed UTF-8', { stage: 'sse.decode', errorName: errorName(error) });
      }
      if (firstChunk) {
        decoded = decoded.replace(/^\uFEFF/, '');
        firstChunk = false;
      }
      buffer += decoded;
      if (buffer.length > maxPendingBytes) throw providerError('Hermes SSE pending buffer exceeded maximum size', { maxPendingBytes, stage: 'sse.buffer' });
      while (true) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) break;
        const rawLine = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (rawLine.length > maxLineBytes) throw providerError('Hermes SSE line exceeded maximum size', { maxLineBytes, stage: 'sse.line' });
        eventBytes += rawLine.length;
        if (eventBytes > maxEventBytes) throw providerError('Hermes SSE event exceeded maximum size', { maxEventBytes, stage: 'sse.event' });
        if (rawLine === '') {
          yield* flush();
          continue;
        }
        if (rawLine.startsWith(':')) continue;
        const colon = rawLine.indexOf(':');
        const field = colon >= 0 ? rawLine.slice(0, colon) : rawLine;
        const value = colon >= 0 ? rawLine.slice(colon + 1).replace(/^ /, '') : '';
        if (field === 'id') eventId = value;
        else if (field === 'event') eventName = value;
        else if (field === 'data') dataLines.push(value);
      }
    }
    try {
      const tail = decoder.decode();
      if (tail) buffer += tail;
    } catch (error) {
      throw providerError('Hermes SSE stream ended with malformed UTF-8', { stage: 'sse.decode', errorName: errorName(error) });
    }
    if (buffer) {
      for (const line of buffer.split(/\r?\n/)) {
        if (line === '') {
          yield* flush();
        } else if (!line.startsWith(':')) {
          const colon = line.indexOf(':');
          const field = colon >= 0 ? line.slice(0, colon) : line;
          const value = colon >= 0 ? line.slice(colon + 1).replace(/^ /, '') : '';
          if (field === 'id') eventId = value;
          else if (field === 'event') eventName = value;
          else if (field === 'data') dataLines.push(value);
        }
      }
    }
    yield* flush();
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
    await iterator.return?.().catch(() => undefined);
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof RuntimeError
    ? signal.reason
    : new RuntimeError({ code: 'CANCELLED', retryable: false, adapterId: 'hermes', message: 'Hermes SSE parsing was cancelled' });
}

function providerError(message: string, details?: Record<string, unknown>): RuntimeError {
  return new RuntimeError({ code: 'PROVIDER_ERROR', retryable: false, adapterId: 'hermes', message, details });
}

function errorName(error: unknown): string | undefined {
  return error && typeof error === 'object' && typeof (error as { name?: unknown }).name === 'string' ? (error as { name: string }).name : undefined;
}
