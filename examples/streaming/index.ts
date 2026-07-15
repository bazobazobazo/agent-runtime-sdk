import type { AgentRuntimeAdapter } from '@banzae/agent-runtime-core';
import { FakeRuntimeAdapter } from '@banzae/agent-runtime-testing';
import { EXAMPLE_ENDPOINT, runExample } from '../shared.js';

export async function streamingExample(): Promise<readonly string[]> {
  return runExample(async (signal) => {
    const adapter: AgentRuntimeAdapter = new FakeRuntimeAdapter();
    try {
      await adapter.connect({ target: { endpoint: EXAMPLE_ENDPOINT } }, { signal });
      const session = await adapter.ensureSession({ applicationSessionId: 'stream-session' }, { signal });
      const run = await adapter.startRun({
        applicationRunId: 'stream-run',
        idempotencyKey: 'stream-key',
        session,
        input: { text: 'Stream a deterministic answer.' },
      }, { signal });
      const eventTypes: string[] = [];
      for await (const event of adapter.streamRun({
        applicationRunId: run.applicationRunId,
        externalRunId: run.externalRunId,
        externalSessionId: session.externalSessionId,
      }, { signal })) {
        eventTypes.push(event.type);
      }
      return eventTypes;
    } finally {
      await adapter.close();
    }
  });
}
