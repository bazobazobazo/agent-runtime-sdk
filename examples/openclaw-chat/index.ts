import { createDefaultRuntimeRegistry, NodeFileStateStore, NodeMemorySecretStore } from '@banzae/agent-runtime-node';
import { runExample } from '../shared.js';

export async function explicitOpenClawExample(): Promise<string> {
  return runExample(async (signal) => {
    const registry = createDefaultRuntimeRegistry({
      stateStore: new NodeFileStateStore('.runtime-state'),
      secretStore: new NodeMemorySecretStore(),
    });
    const adapter = registry.create('openclaw');
    try {
      signal.throwIfAborted();
      // Construction-only: connect only in an explicitly configured live harness.
      return `${adapter.adapterId}:${adapter.lifecycleState}`;
    } finally {
      await adapter.close();
    }
  });
}
