import { TEXT_RUN_CAPABILITIES } from '@banzae/agent-runtime-core/testing';
import type { AgentRuntimeAdapter } from '@banzae/agent-runtime-core';
import {
  FakeRuntimeAdapter,
  createRuntimeAdapterConformanceSuite,
} from '@banzae/agent-runtime-testing';
import { EXAMPLE_ENDPOINT, runExample } from '../shared.js';

export async function adapterAuthoringExample(): Promise<number> {
  return runExample(async (signal) => {
    const adapter: AgentRuntimeAdapter = new FakeRuntimeAdapter();
    try {
      signal.throwIfAborted();
      const suite = createRuntimeAdapterConformanceSuite({
        name: 'Future adapter',
        createTarget: () => ({
          connection: { target: { endpoint: EXAMPLE_ENDPOINT } },
        }),
        createAdapter: () => new FakeRuntimeAdapter(),
        expectedCapabilities: TEXT_RUN_CAPABILITIES,
        scenarios: {
          session: () => ({ applicationSessionId: 'conformance-session' }),
          run: (_target, session) => ({
            applicationRunId: 'conformance-run',
            idempotencyKey: 'conformance-key',
            session,
            input: { text: 'Conformance example' },
          }),
        },
      });
      return suite.cases.length;
    } finally {
      await adapter.close();
    }
  });
}
