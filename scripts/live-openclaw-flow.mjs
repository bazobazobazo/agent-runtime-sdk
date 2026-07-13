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
const stateRoot = process.env.OPENCLAW_SDK_STATE_DIR ?? '.runtime-state/live-openclaw-flow';
const legacyStoreDir = process.env.OPENCLAW_CLIENT_STORE_DIR;
const devicePairing = process.env.OPENCLAW_DEVICE_PAIRING ?? 'stored';
const scopes = (process.env.OPENCLAW_SCOPES ?? 'operator.read,operator.write')
  .split(',')
  .map((scope) => scope.trim())
  .filter(Boolean);

if (!endpoint) throw new Error('OPENCLAW_GATEWAY_URL is required');
const legacy = legacyStoreDir ? await loadLegacyOpenClawStore(legacyStoreDir) : undefined;
if (legacy) {
  const seeded = await seedSdkOpenClawState({ sdkStateRoot: stateRoot, endpoint, legacy });
  console.log(JSON.stringify({ step: 'seed-openclaw-state', seeded: seeded.seeded, hasDeviceToken: seeded.hasDeviceToken }, null, 2));
}
if (!token && !legacy?.deviceToken) {
  throw new Error('OPENCLAW_GATEWAY_TOKEN or OPENCLAW_CLIENT_STORE_DIR with a device token is required for flow validation');
}

const registry = createDefaultRuntimeRegistry({
  stateStore: new NodeFileStateStore(stateRoot),
  secretStore: new NodeMemorySecretStore(),
  openclaw: {
    devicePairing,
    role: process.env.OPENCLAW_ROLE ?? 'operator',
    scopes,
  },
});
const adapter = registry.create('openclaw');
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const sessionId = `sdk-live-openclaw-${suffix}`;
const runId = `sdk-live-openclaw-run-${suffix}`;
let closed = false;

try {
  await adapter.connect({
    target: { endpoint },
    auth: token ? { kind: 'token', token } : { kind: 'device-token', token: legacy.deviceToken, deviceId: legacy.deviceId },
    options: protocol ? { protocolVersion: protocol } : undefined,
  });

  const session = await adapter.ensureSession({
    applicationSessionId: sessionId,
    title: 'SDK live OpenClaw validation',
  });
  const run = await adapter.startRun({
    applicationRunId: runId,
    idempotencyKey: `sdk-live:openclaw:${sessionId}:reply`,
    session,
    input: { text: 'Reply exactly with: sdk-live-ok' },
    instructions: 'Keep the answer to exactly the requested text.',
  });
  const snapshot = await adapter.getRun({
    applicationRunId: run.applicationRunId,
    externalRunId: run.externalRunId,
    externalSessionId: session.externalSessionId,
  });
  const history = await adapter.getHistory({
    applicationSessionId: session.applicationSessionId,
    externalSessionId: session.externalSessionId,
    limit: 10,
  });

  const cancelStatus = await validateCancelPath(adapter, session, `${runId}-cancel`);
  await adapter.close();
  closed = true;

  const output = snapshot.output ?? history.map((message) => message.content).join('\n');
  if (!/sdk-live-ok/i.test(output)) {
    throw new Error(`OpenClaw live flow did not observe expected output. Snapshot status: ${snapshot.status}`);
  }

  console.log(JSON.stringify({
    runtime: 'openclaw',
    protocol,
    sessionId,
    runStatus: snapshot.status,
    observedExpectedOutput: true,
    historyCount: history.length,
    cancelStatus,
  }, null, 2));
} finally {
  if (!closed) await adapter.close().catch(() => undefined);
}

async function validateCancelPath(adapter, session, applicationRunId) {
  const cancelRun = await adapter.startRun({
    applicationRunId,
    idempotencyKey: `sdk-live:openclaw:${session.applicationSessionId}:cancel`,
    session,
    input: {
      text: [
        'Cancellation validation run.',
        'If this is not cancelled, reply exactly with: sdk-cancel-not-observed.',
        'Spend as much time as your runtime naturally allows before answering.',
      ].join(' '),
    },
    instructions: 'This run exists only to validate cancellation plumbing.',
  });

  try {
    await adapter.cancelRun({
      applicationRunId: cancelRun.applicationRunId,
      externalRunId: cancelRun.externalRunId,
      externalSessionId: session.externalSessionId,
    });
    return 'real-run-cancel-accepted';
  } catch (error) {
    return `real-run-cancel-returned-${error?.code ?? 'error'}`;
  }
}
