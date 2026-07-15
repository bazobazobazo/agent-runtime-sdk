import type { AgentRuntimeAdapter } from '@banzae/agent-runtime-core';
import { FakeRuntimeAdapter } from '@banzae/agent-runtime-testing';
import { EXAMPLE_ENDPOINT, runExample } from '../shared.js';

export async function cancellationExample(): Promise<void> {
  return runExample(async (signal) => {
    const adapter: AgentRuntimeAdapter = new FakeRuntimeAdapter();
    try {
      await adapter.connect({ target: { endpoint: EXAMPLE_ENDPOINT } }, { signal });
      const session = await adapter.ensureSession({ applicationSessionId: 'cancel-session' }, { signal });
      const run = await adapter.startRun({
        applicationRunId: 'cancel-run',
        idempotencyKey: 'cancel-key',
        session,
        input: { text: 'Start cancellable work.' },
      }, { signal });
      await adapter.cancelRun({
        applicationRunId: run.applicationRunId,
        externalRunId: run.externalRunId,
        externalSessionId: session.externalSessionId,
      }, { signal });
    } finally {
      await adapter.close();
    }
  });
}
