import { DefaultRuntimeNetworkPolicy } from '@banzae/agent-runtime-detection';
import type { AgentRuntimeAdapter } from '@banzae/agent-runtime-core';
import { FakeRuntimeAdapter } from '@banzae/agent-runtime-testing';
import { EXAMPLE_ENDPOINT, runExample } from '../shared.js';

export async function networkPolicyExample(): Promise<string> {
  return runExample(async (signal) => {
    const adapter: AgentRuntimeAdapter = new FakeRuntimeAdapter();
    try {
      signal.throwIfAborted();
      const policy = new DefaultRuntimeNetworkPolicy();
      const endpoint = new URL(EXAMPLE_ENDPOINT);
      await policy.validateTarget(endpoint);
      return endpoint.hostname;
    } finally {
      await adapter.close();
    }
  });
}
