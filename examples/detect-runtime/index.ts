import { createDefaultRuntimeRegistry, NodeFileStateStore, NodeMemorySecretStore, detectRuntime } from '@banzae/agent-runtime-node';

const endpoint = process.env.RUNTIME_ENDPOINT;
if (!endpoint) throw new Error('Set RUNTIME_ENDPOINT');

const registry = createDefaultRuntimeRegistry({
  stateStore: new NodeFileStateStore('.runtime-state'),
  secretStore: new NodeMemorySecretStore(),
});

const result = await detectRuntime({ endpoint }, { registry });
console.log(JSON.stringify(result, null, 2));
