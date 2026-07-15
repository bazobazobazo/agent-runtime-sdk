#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { artifactRoot, readJson, root } from './lib/release-config.mjs';

const exec = promisify(execFile);
if (!process.argv.includes('--use-existing')) {
  await exec(process.execPath, ['./scripts/prepare-release-packages.mjs'], { cwd: root, maxBuffer: 30 * 1024 * 1024 });
}
const packResults = await readJson(join(artifactRoot, 'pack-results.json'));
const temp = await mkdtemp(join(tmpdir(), 'agent-runtime-packed-consumer-'));

try {
  const localPackages = Object.fromEntries(packResults.packages.map((pkg) => [
    pkg.name,
    `file:${join(artifactRoot, pkg.tarball)}`,
  ]));
  await writeFile(join(temp, 'package.json'), `${JSON.stringify({
    name: 'agent-runtime-sdk-packed-consumer',
    private: true,
    type: 'module',
    dependencies: localPackages,
  }, null, 2)}\n`);
  await writeFile(join(temp, 'pnpm-workspace.yaml'), [
    'packages:',
    "  - '.'",
    'overrides:',
    ...Object.entries(localPackages).map(([name, path]) => `  ${JSON.stringify(name)}: ${JSON.stringify(path)}`),
    '',
  ].join('\n'));
  await exec('pnpm', ['install', '--prefer-offline', '--ignore-scripts'], { cwd: temp, maxBuffer: 30 * 1024 * 1024 });
  await writeFile(join(temp, 'consumer.ts'), `
import {
  RuntimeError,
  isRuntimeError,
  type AgentRuntimeAdapter,
  type RuntimeApprovalDecision,
  type RuntimeEvent,
} from '@banzae/agent-runtime-core';
import { createTestDependencies } from '@banzae/agent-runtime-core/testing';
import { sanitizeProviderPayload } from '@banzae/agent-runtime-core/diagnostics';
import { withDeadline } from '@banzae/agent-runtime-core/experimental';
import { createOpenClawAdapterFactory } from '@banzae/agent-runtime-openclaw';
import { openClawV4Codec } from '@banzae/agent-runtime-openclaw/experimental';
import { createHermesAdapterFactory } from '@banzae/agent-runtime-hermes';
import { parseSseStream } from '@banzae/agent-runtime-hermes/experimental';
import { createRuntimeDetector, type RuntimeProbe } from '@banzae/agent-runtime-detection';
import {
  FakeHermesServer,
  FakeOpenClawV4Server,
  createRuntimeAdapterConformanceSuite,
} from '@banzae/agent-runtime-testing';
import { FetchHttpTransport, WsWebSocketFactory } from '@banzae/agent-runtime-node';

const controller = new AbortController();
const openServer = new FakeOpenClawV4Server();
const openAdapter: AgentRuntimeAdapter = createOpenClawAdapterFactory().create({
  ...createTestDependencies(),
  webSockets: openServer,
});
try {
  await openAdapter.connect(openServer.createTarget().connection, { signal: controller.signal });
  const session = await openAdapter.ensureSession({ applicationSessionId: 'consumer-openclaw-session' }, { signal: controller.signal });
  const run = await openAdapter.startRun({
    applicationRunId: 'consumer-openclaw-run',
    idempotencyKey: 'consumer-openclaw-key',
    session,
    input: { text: 'synthetic consumer flow' },
  }, { signal: controller.signal });
  if (!run.externalRunId) throw new Error('OpenClaw construction flow failed');
} finally {
  await openAdapter.close();
  await openServer.shutdown();
}

const hermesServer = new FakeHermesServer();
const hermesAdapter: AgentRuntimeAdapter = createHermesAdapterFactory().create({
  ...createTestDependencies(),
  http: hermesServer,
});
try {
  await hermesAdapter.connect({ target: { endpoint: 'https://runtime.example.com' } }, { signal: controller.signal });
  const session = await hermesAdapter.ensureSession({ applicationSessionId: 'consumer-hermes-session' }, { signal: controller.signal });
  const run = await hermesAdapter.startRun({
    applicationRunId: 'consumer-hermes-run',
    idempotencyKey: 'consumer-hermes-key',
    session,
    input: { text: 'synthetic consumer flow' },
  }, { signal: controller.signal });
  if (!run.externalRunId) throw new Error('Hermes construction flow failed');
} finally {
  await hermesAdapter.close();
  await hermesServer.shutdown();
}

const probe: RuntimeProbe = {
  adapterId: 'synthetic',
  async probe() {
    return { adapterId: 'synthetic', matched: true, confidence: 1, runtimeProduct: 'synthetic', protocolName: 'synthetic', evidence: [] };
  },
};
const detection = await createRuntimeDetector({ dependencies: createTestDependencies(), probes: [probe] }).detect({
  target: { endpoint: 'https://runtime.example.com' },
  options: { allowManifest: false, signal: controller.signal },
});
if (detection.selected?.adapterId !== 'synthetic') throw new Error('Detector flow failed');

const decision: RuntimeApprovalDecision = { action: 'allow', scope: 'once' };
const narrow = (event: RuntimeEvent) => event.type === 'assistant.delta' ? event.delta : event.eventId;
const error = new RuntimeError({ code: 'INVALID_REQUEST', message: 'safe', retryable: false });
if (!isRuntimeError(error)) throw new Error('RuntimeError narrowing failed');
void [decision, narrow, sanitizeProviderPayload({ ok: true }), withDeadline, openClawV4Codec, parseSseStream];
void [createRuntimeAdapterConformanceSuite, new FetchHttpTransport(), new WsWebSocketFactory()];

for (const specifier of [
  '@banzae/agent-runtime-core/src/types.js',
  '@banzae/agent-runtime-openclaw/src/protocol/types.js',
  '@banzae/agent-runtime-hermes/src/schemas.js',
]) {
  try {
    await import(specifier);
    throw new Error(\`Prohibited deep import unexpectedly resolved: \${specifier}\`);
  } catch (caught) {
    if (caught instanceof Error && caught.message.startsWith('Prohibited deep import')) throw caught;
  }
}
controller.abort();
console.log('Packed consumer runtime flows passed.');
`, 'utf8');
  await writeFile(join(temp, 'tsconfig.json'), `${JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      skipLibCheck: true,
      outDir: 'dist',
    },
    include: ['consumer.ts'],
  }, null, 2)}\n`);
  await exec(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(temp, 'tsconfig.json')], {
    cwd: temp,
    maxBuffer: 30 * 1024 * 1024,
  });
  const runtime = await exec(process.execPath, [join(temp, 'dist', 'consumer.js')], { cwd: temp, maxBuffer: 30 * 1024 * 1024 });
  process.stdout.write(runtime.stdout);
  console.log(`Packed consumer installed and executed ${packResults.packages.length} archives outside the workspace.`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
