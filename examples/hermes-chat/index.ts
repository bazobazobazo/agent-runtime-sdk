import { createDefaultRuntimeRegistry, NodeFileStateStore, NodeMemorySecretStore } from '@banzae/agent-runtime-node';

const endpoint = process.env.HERMES_BASE_URL;
const token = process.env.HERMES_BEARER_TOKEN;
if (!endpoint) throw new Error('Set HERMES_BASE_URL');

const registry = createDefaultRuntimeRegistry({
  stateStore: new NodeFileStateStore('.runtime-state'),
  secretStore: new NodeMemorySecretStore(),
});
const adapter = registry.create('hermes');
await adapter.connect({ target: { endpoint }, auth: token ? { kind: 'bearer', token } : undefined });
console.log(await adapter.health());
await adapter.close();
