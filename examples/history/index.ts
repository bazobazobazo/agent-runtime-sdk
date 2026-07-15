import type { AgentRuntimeAdapter } from '@banzae/agent-runtime-core';
import { FakeRuntimeAdapter } from '@banzae/agent-runtime-testing';
import { EXAMPLE_ENDPOINT, runExample } from '../shared.js';

export async function historyExample(): Promise<readonly string[]> {
  return runExample(async (signal) => {
    const adapter: AgentRuntimeAdapter = new FakeRuntimeAdapter();
    try {
      await adapter.connect({ target: { endpoint: EXAMPLE_ENDPOINT } }, { signal });
      const session = await adapter.ensureSession({ applicationSessionId: 'history-session' }, { signal });
      const page = await adapter.getHistory({
        applicationSessionId: session.applicationSessionId,
        externalSessionId: session.externalSessionId,
        limit: 20,
      }, { signal });
      return page.messages.map((message) => message.content);
    } finally {
      await adapter.close();
    }
  });
}
