#!/usr/bin/env node
import {
  createDefaultRuntimeRegistry,
  NodeFileStateStore,
  NodeMemorySecretStore,
} from '../packages/node/dist/index.js';

const endpoint = process.env.HERMES_BASE_URL;
const token = process.env.HERMES_BEARER_TOKEN;
if (!endpoint) throw new Error('HERMES_BASE_URL is required');

const registry = createDefaultRuntimeRegistry({
  stateStore: new NodeFileStateStore('.runtime-state/live-hermes'),
  secretStore: new NodeMemorySecretStore(),
  hermes: token ? { bearerToken: token } : undefined,
});
const adapter = registry.create('hermes');
const probe = await adapter.probe({ endpoint }, { allowAuthentication: Boolean(token), timeoutMs: 10_000 });
console.log(JSON.stringify({ step: 'probe', matched: probe.matched, confidence: probe.confidence, evidence: probe.evidence, warnings: probe.warnings }, null, 2));
await adapter.connect({ target: { endpoint }, auth: token ? { kind: 'bearer', token } : { kind: 'none' } });
const health = await adapter.health();
console.log(JSON.stringify({ step: 'health', status: health.status, descriptor: health.descriptor, warnings: health.warnings }, null, 2));
await adapter.close();
