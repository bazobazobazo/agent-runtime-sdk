import { RuntimeError } from './errors.js';

export async function withDeadline<T>(
  work: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) {
    throw signal.reason instanceof RuntimeError
      ? signal.reason
      : new RuntimeError({ code: 'CANCELLED', retryable: false, message: 'Operation was aborted' });
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    const abortSignal = signal;
    const onAbort = () =>
      reject(
        abortSignal?.reason instanceof RuntimeError
          ? abortSignal.reason
          : new RuntimeError({ code: 'CANCELLED', retryable: false, message: 'Operation was aborted' }),
      );
    signal?.addEventListener('abort', onAbort, { once: true });
    timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      reject(new RuntimeError({ code: 'TIMEOUT', retryable: true, message: `Operation timed out after ${timeoutMs}ms` }));
    }, timeoutMs);
  });

  try {
    return await Promise.race([work, abortPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function* emptyAsyncIterable<T>(): AsyncIterable<T> {
  return;
}

export async function collectBytes(body: AsyncIterable<Uint8Array>, maxBytes = 1_000_000): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > maxBytes) {
      throw new RuntimeError({
        code: 'PROVIDER_ERROR',
        retryable: false,
        message: `Response exceeded ${maxBytes} bytes`,
      });
    }
    chunks.push(chunk);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function readJsonBody(body: AsyncIterable<Uint8Array>, maxBytes?: number): Promise<unknown> {
  const bytes = await collectBytes(body, maxBytes);
  const text = new TextDecoder().decode(bytes);
  return text ? JSON.parse(text) : null;
}

export async function runWithConcurrencyLimit<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item !== undefined) {
        results[index] = await work(item);
      }
    }
  });
  await Promise.all(workers);
  return results;
}
