#!/usr/bin/env node
import {
  createDefaultRuntimeRegistry,
  NodeFileStateStore,
  NodeMemorySecretStore,
} from '../packages/node/dist/index.js';
import {
  loadLegacyOpenClawStore,
  seedSdkOpenClawState,
} from './lib/openclaw-legacy-store.mjs';

const endpoint = process.env.OPENCLAW_GATEWAY_URL;
const token = process.env.OPENCLAW_GATEWAY_TOKEN;
const protocol = process.env.OPENCLAW_PROTOCOL ? Number(process.env.OPENCLAW_PROTOCOL) : undefined;
const stateRoot = process.env.OPENCLAW_SDK_STATE_DIR ?? '.runtime-state/live-openclaw';
const legacyStoreDir = process.env.OPENCLAW_CLIENT_STORE_DIR;

if (!endpoint) throw new Error('OPENCLAW_GATEWAY_URL is required');
if (legacyStoreDir) {
  const legacy = await loadLegacyOpenClawStore(legacyStoreDir);
  const seeded = await seedSdkOpenClawState({ sdkStateRoot: stateRoot, endpoint, legacy });
  console.log(JSON.stringify({ step: 'seed-openclaw-state', seeded: seeded.seeded, hasDeviceToken: seeded.hasDeviceToken }, null, 2));
}

const registry = createDefaultRuntimeRegistry({
  stateStore: new NodeFileStateStore(stateRoot),
  secretStore: new NodeMemorySecretStore(),
});
const adapter = registry.create('openclaw');
const probe = await adapter.probe({ endpoint }, { allowAuthentication: false, timeoutMs: 10_000 });
console.log(JSON.stringify({ step: 'probe', matched: probe.matched, confidence: probe.confidence, evidence: probe.evidence, warnings: probe.warnings }, null, 2));

await adapter.connect({
  target: { endpoint },
  auth: token ? { kind: 'token', token } : { kind: 'none' },
  options: protocol ? { protocolVersion: protocol } : undefined,
});
const health = await adapter.health();
console.log(JSON.stringify({ step: 'health', status: health.status, descriptor: health.descriptor, warnings: health.warnings }, null, 2));
await adapter.close();
