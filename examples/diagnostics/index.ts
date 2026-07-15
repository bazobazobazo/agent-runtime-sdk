import { sanitizeProviderPayload } from '@banzae/agent-runtime-core/diagnostics';
import type { AgentRuntimeAdapter } from '@banzae/agent-runtime-core';
import { FakeRuntimeAdapter } from '@banzae/agent-runtime-testing';
import { runExample } from '../shared.js';

export async function diagnosticsExample(): Promise<unknown> {
  return runExample(async (signal) => {
    const adapter: AgentRuntimeAdapter = new FakeRuntimeAdapter();
    try {
      signal.throwIfAborted();
      return sanitizeProviderPayload({
        endpoint: 'https://runtime.example.com',
        status: 'example',
      });
    } finally {
      await adapter.close();
    }
  });
}
