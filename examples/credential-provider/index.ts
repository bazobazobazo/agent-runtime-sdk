import { EnvironmentRuntimeCredentialProvider } from '@banzae/agent-runtime-node';
import type { AgentRuntimeAdapter } from '@banzae/agent-runtime-core';
import { FakeRuntimeAdapter } from '@banzae/agent-runtime-testing';
import { runExample } from '../shared.js';

export async function credentialProviderExample(): Promise<string> {
  return runExample(async (signal) => {
    const adapter: AgentRuntimeAdapter = new FakeRuntimeAdapter();
    try {
      signal.throwIfAborted();
      const provider = new EnvironmentRuntimeCredentialProvider({
        environment: { EXAMPLE_RUNTIME_CREDENTIAL: 'not-a-real-secret' },
        defaultKind: 'bearer',
      });
      const auth = await provider.resolve('env:EXAMPLE_RUNTIME_CREDENTIAL');
      return auth.kind;
    } finally {
      await adapter.close();
    }
  });
}
