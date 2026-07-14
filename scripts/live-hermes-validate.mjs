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

if (process.env.HERMES_LIVE_RUN_TEXT) {
  const session = await adapter.ensureSession({ applicationSessionId: `live-hermes-${Date.now()}` });
  const handle = await adapter.startRun({
    applicationRunId: `live-run-${Date.now()}`,
    idempotencyKey: `live-hermes-${Date.now()}`,
    session,
    input: { text: process.env.HERMES_LIVE_RUN_TEXT },
    instructions: process.env.HERMES_LIVE_RUN_INSTRUCTIONS,
  });
  console.log(JSON.stringify({ step: 'run.started', externalRunId: handle.externalRunId, status: handle.status, sessionStatePatch: handle.sessionStatePatch }, null, 2));
  if (process.env.HERMES_LIVE_STREAM !== '0') {
    for await (const event of adapter.streamRun({
      applicationRunId: handle.applicationRunId,
      externalRunId: handle.externalRunId,
      externalSessionId: session.externalSessionId,
      providerState: handle.providerState,
    })) {
      console.log(JSON.stringify({ step: 'run.event', type: event.type, eventId: event.eventId }, null, 2));
    }
  }
  const final = await adapter.getRun({
    applicationRunId: handle.applicationRunId,
    externalRunId: handle.externalRunId,
    externalSessionId: session.externalSessionId,
    providerState: handle.providerState,
  });
  console.log(JSON.stringify({ step: 'run.final', status: final.status, output: final.output, usage: final.usage, sessionStatePatch: final.sessionStatePatch }, null, 2));
}

if (process.env.HERMES_LIVE_CANCEL_RUN_ID) {
  await adapter.cancelRun({
    applicationRunId: 'live-cancel',
    externalRunId: process.env.HERMES_LIVE_CANCEL_RUN_ID,
  });
  console.log(JSON.stringify({ step: 'cancel.requested', externalRunId: process.env.HERMES_LIVE_CANCEL_RUN_ID }, null, 2));
}

await adapter.close();
