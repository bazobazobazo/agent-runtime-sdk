import { isRuntimeError, toRuntimeError } from '@banzae/agent-runtime-core';

export const EXAMPLE_ENDPOINT = 'https://runtime.example.com';
export const EXAMPLE_SOCKET = 'wss://runtime.example.com';

export async function runExample<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  try {
    return await work(controller.signal);
  } catch (error) {
    const normalized = isRuntimeError(error)
      ? error
      : toRuntimeError(error, {
          code: 'INTERNAL',
          retryable: false,
          message: 'Example failed',
          operation: 'example.run',
        });
    console.error(normalized.code, normalized.message);
    throw normalized;
  } finally {
    controller.abort();
  }
}
