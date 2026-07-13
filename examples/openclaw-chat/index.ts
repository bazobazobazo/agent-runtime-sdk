import { createDefaultRuntimeRegistry, NodeFileStateStore, NodeMemorySecretStore } from '@banzae/agent-runtime-node';

const endpoint = process.env.OPENCLAW_GATEWAY_URL;
const token = process.env.OPENCLAW_GATEWAY_TOKEN;
if (!endpoint || !token) throw new Error('Set OPENCLAW_GATEWAY_URL and OPENCLAW_GATEWAY_TOKEN');

const registry = createDefaultRuntimeRegistry({
  stateStore: new NodeFileStateStore('.runtime-state'),
  secretStore: new NodeMemorySecretStore(),
});
const adapter = registry.create('openclaw');
await adapter.connect({ target: { endpoint }, auth: { kind: 'token', token } });
console.log(await adapter.health());
await adapter.close();
