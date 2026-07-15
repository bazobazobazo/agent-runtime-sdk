import { createDefaultRuntimeRegistry, NodeFileStateStore, NodeMemorySecretStore } from '@banzae/agent-runtime-node';
import { runExample } from '../shared.js';

export async function explicitHermesExample(): Promise<string> {
  return runExample(async (signal) => {
    const registry = createDefaultRuntimeRegistry({
      stateStore: new NodeFileStateStore('.runtime-state'),
      secretStore: new NodeMemorySecretStore(),
    });
    const adapter = registry.create('hermes');
    try {
      signal.throwIfAborted();
      // Construction-only: no external endpoint is contacted.
      return `${adapter.adapterId}:${adapter.lifecycleState}`;
    } finally {
      await adapter.close();
    }
  });
}
