#!/usr/bin/env node
import {
  createDefaultRuntimeRegistry,
  NodeFileStateStore,
  NodeMemorySecretStore,
} from '../packages/node/dist/index.js';

const endpoint = process.env.HERMES_BASE_URL;
const token = process.env.HERMES_BEARER_TOKEN;
const stateRoot = process.env.HERMES_SDK_STATE_DIR ?? '.runtime-state/live-hermes-flow';

if (!endpoint) throw new Error('HERMES_BASE_URL is required');
if (!token) throw new Error('HERMES_BEARER_TOKEN is required for flow validation');

const registry = createDefaultRuntimeRegistry({
  stateStore: new NodeFileStateStore(stateRoot),
  secretStore: new NodeMemorySecretStore(),
  hermes: { bearerToken: token },
});
const adapter = registry.create('hermes');
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const sessionId = `sdk-live-hermes-${suffix}`;
const runId = `sdk-live-hermes-run-${suffix}`;

await adapter.connect({ target: { endpoint }, auth: { kind: 'bearer', token } });
const session = await adapter.ensureSession({
  applicationSessionId: sessionId,
  title: 'SDK live Hermes validation',
});
const run = await adapter.startRun({
  applicationRunId: runId,
  idempotencyKey: `sdk-live:hermes:${sessionId}:reply`,
  session,
  input: { text: 'Reply exactly with: sdk-live-ok' },
  instructions: 'Keep the answer to exactly the requested text.',
});

let streamedText = '';
let completedFromStream = false;
for await (const event of adapter.streamRun({
  applicationRunId: run.applicationRunId,
  externalRunId: run.externalRunId,
  externalSessionId: session.externalSessionId,
})) {
  if (event.type === 'assistant.delta') streamedText += event.delta;
  if (event.type === 'assistant.completed') streamedText = event.text;
  if (event.type === 'run.completed') {
    completedFromStream = true;
    break;
  }
  if (event.type === 'run.failed') throw new Error(`Hermes run failed: ${event.error.message}`);
}

const snapshot = await waitForTerminalSnapshot(adapter, {
  applicationRunId: run.applicationRunId,
  externalRunId: run.externalRunId,
  externalSessionId: session.externalSessionId,
});
const cancelStatus = await validateCancelPath(adapter, session);
await adapter.close();

const output = snapshot.output ?? streamedText;
if (!/sdk-live-ok/i.test(output)) {
  throw new Error(`Hermes live flow did not observe expected output. Snapshot status: ${snapshot.status}`);
}

console.log(JSON.stringify({
  runtime: 'hermes',
  sessionId,
  runStatus: snapshot.status,
  completedFromStream,
  observedExpectedOutput: true,
  cancelStatus,
}, null, 2));

async function waitForTerminalSnapshot(adapter, input) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const snapshot = await adapter.getRun(input);
    if (['completed', 'failed', 'cancelled'].includes(snapshot.status)) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return adapter.getRun(input);
}

async function validateCancelPath(adapter, session) {
  const cancelRun = await adapter.startRun({
    applicationRunId: `${runId}-cancel`,
    idempotencyKey: `sdk-live:hermes:${session.applicationSessionId}:cancel`,
    session,
    input: { text: 'Wait briefly, then reply with cancelled-test.' },
    instructions: 'Do not perform external actions.',
  });
  await adapter.cancelRun({
    applicationRunId: cancelRun.applicationRunId,
    externalRunId: cancelRun.externalRunId,
    externalSessionId: session.externalSessionId,
  });
  const snapshot = await waitForTerminalSnapshot(adapter, {
    applicationRunId: cancelRun.applicationRunId,
    externalRunId: cancelRun.externalRunId,
    externalSessionId: session.externalSessionId,
  });
  return snapshot.status;
}
