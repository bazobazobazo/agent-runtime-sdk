import type { AgentRuntimeAdapter } from '@banzae/agent-runtime-core';
import { FakeRuntimeAdapter } from '@banzae/agent-runtime-testing';
import { EXAMPLE_ENDPOINT, runExample } from '../shared.js';

export async function lifecycleExample(): Promise<string> {
  return runExample(async (signal) => {
    const adapter: AgentRuntimeAdapter = new FakeRuntimeAdapter();
    try {
      await adapter.connect({ target: { endpoint: EXAMPLE_ENDPOINT } }, { signal });
      const session = await adapter.ensureSession(
        { applicationSessionId: 'example-session' },
        { signal },
      );
      const run = await adapter.startRun(
        {
          applicationRunId: 'example-run',
          idempotencyKey: 'example-idempotency-key',
          session,
          input: { text: 'Hello from the deterministic example.' },
        },
        { signal },
      );
      return run.externalRunId;
    } finally {
      await adapter.close();
    }
  });
}
