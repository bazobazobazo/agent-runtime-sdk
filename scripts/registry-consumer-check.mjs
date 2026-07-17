#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { artifactRoot, publicPackages, releaseConfig, root, tarballName } from './lib/release-config.mjs';

const host = '127.0.0.1';
const temporaryRoot = await mkdtemp(join(tmpdir(), 'agent-runtime-registry-check-'));
const registryStorage = join(temporaryRoot, 'registry');
const consumer = join(temporaryRoot, 'consumer');
const port = await availablePort(host);
const registry = `http://${host}:${port}`;
assertLoopbackRegistry(registry);
let server;

try {
  await mkdir(registryStorage, { recursive: true });
  await writeFile(join(temporaryRoot, 'verdaccio.yml'), verdaccioConfig(registryStorage, host, port), 'utf8');
  await run('pnpm', ['build'], { cwd: root });
  await run(process.execPath, ['./scripts/prepare-release-packages.mjs'], { cwd: root });
  await run('pnpm', ['independence:check'], { cwd: root });

  server = spawn(join(root, 'node_modules', '.bin', 'verdaccio'), ['--config', join(temporaryRoot, 'verdaccio.yml'), '--listen', `${host}:${port}`], {
    cwd: root,
    env: cleanNpmEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  server.stdout.on('data', (chunk) => { serverOutput += String(chunk); });
  server.stderr.on('data', (chunk) => { serverOutput += String(chunk); });
  await waitForRegistry(registry, server, () => serverOutput);
  const localToken = await createLocalRegistryUser(registry);
  const publishConfig = join(temporaryRoot, 'publish-npmrc');
  await writeFile(publishConfig, `registry=${registry}\n//${host}:${port}/:_authToken=${localToken}\n`, { mode: 0o600 });

  const packages = await publicPackages();
  for (const pkg of packages) {
    const tarball = join(artifactRoot, 'tarballs', tarballName(pkg.name));
    const args = ['publish', tarball, '--registry', registry, '--access', 'public', '--tag', 'next', '--provenance=false'];
    assertExplicitLocalPublish(args);
    await run('npm', args, { cwd: root, env: cleanNpmEnvironment(publishConfig) });
  }

  for (const pkg of packages) {
    const exact = await capture('npm', ['view', `${pkg.name}@${releaseConfig.sdkVersion}`, 'version', '--registry', registry], { cwd: root, env: cleanNpmEnvironment() });
    const next = await capture('npm', ['view', `${pkg.name}@next`, 'version', '--registry', registry], { cwd: root, env: cleanNpmEnvironment() });
    if (exact.trim() !== releaseConfig.sdkVersion || next.trim() !== releaseConfig.sdkVersion) throw new Error(`${pkg.name} version or next dist-tag verification failed`);
  }

  await mkdir(consumer, { recursive: true });
  await writeFile(join(consumer, '.npmrc'), `@banzae:registry=${registry}\nregistry=https://registry.npmjs.org/\n`, 'utf8');
  await writeFile(join(consumer, 'package.json'), JSON.stringify({
    name: 'agent-runtime-registry-consumer', private: true, type: 'module',
    dependencies: Object.fromEntries(packages.map((pkg) => [pkg.name, releaseConfig.sdkVersion])),
  }, null, 2));
  await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noUncheckedIndexedAccess: true, outDir: 'dist', skipLibCheck: false },
    include: ['index.ts'],
  }, null, 2));
  await writeFile(join(consumer, 'index.ts'), consumerSource(), 'utf8');
  await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: consumer, env: cleanNpmEnvironment() });

  const lock = await readFile(join(consumer, 'package-lock.json'), 'utf8');
  if (/\b(?:file|link|workspace):/i.test(lock)) throw new Error('Clean consumer lockfile contains a workspace or path reference');
  await run(join(root, 'node_modules', '.bin', 'tsc'), ['-p', join(consumer, 'tsconfig.json')], { cwd: consumer });
  await run(process.execPath, [join(consumer, 'dist', 'index.js')], { cwd: consumer });
  await run(process.execPath, ['-e', "import('@banzae/agent-runtime-core/dist/types.js').then(()=>process.exit(2)).catch(e=>process.exit(e.code==='ERR_PACKAGE_PATH_NOT_EXPORTED'?0:3))"], { cwd: consumer });

  console.log(`Local registry consumer check passed for ${packages.length} packages at ${releaseConfig.sdkVersion} with dist-tag next.`);
} finally {
  if (server && server.exitCode == null) {
    server.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => server.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 5_000))]);
    if (server.exitCode == null) server.kill('SIGKILL');
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}

function consumerSource() {
  return `
import { RuntimeError } from '@banzae/agent-runtime-core';
import { createTestDependencies } from '@banzae/agent-runtime-core/testing';
import { sanitizeDetails } from '@banzae/agent-runtime-core/diagnostics';
import { validateRuntimeAttachments } from '@banzae/agent-runtime-core/experimental';
import { OpenClawAdapter } from '@banzae/agent-runtime-openclaw';
import { openClawV3Codec, openClawV4Codec } from '@banzae/agent-runtime-openclaw/experimental';
import { createRuntimeDetector } from '@banzae/agent-runtime-detection';
import { FakeOpenClawV3Server, FakeOpenClawV4Server } from '@banzae/agent-runtime-testing';
import { NodeMemorySecretStore } from '@banzae/agent-runtime-node';
import { HermesAdapter } from '@banzae/agent-runtime-hermes';

void sanitizeDetails({ token: 'hidden' });
void validateRuntimeAttachments([], { maxCount: 1, maxBytes: 1 });
void NodeMemorySecretStore;
void HermesAdapter;

for (const [version, Server, codec] of [[3, FakeOpenClawV3Server, openClawV3Codec], [4, FakeOpenClawV4Server, openClawV4Codec]] as const) {
  const server = new Server();
  const dependencies = createTestDependencies({ webSockets: server });
  const adapter = new OpenClawAdapter(dependencies, { protocols: [codec()] });
  const connection = await adapter.connect(server.createTarget().connection);
  if (connection.descriptor.protocolVersion !== String(version)) throw new Error('protocol mismatch');
  const session = await adapter.ensureSession({ applicationSessionId: 'consumer-session-' + version });
  const run = await adapter.startRun({
    applicationRunId: 'consumer-run-' + version, idempotencyKey: 'consumer-key-' + version, session,
    input: { text: 'hello', attachments: [
      { kind: 'image', name: 'pixel.png', mimeType: 'image/png', data: Uint8Array.of(1, 2, 3, 4) },
      { kind: 'file', name: 'marker.txt', mimeType: 'text/plain', data: new TextEncoder().encode('BANZAE_RUNTIME_COMPATIBILITY_OK') },
    ] },
  });
  await adapter.cancelRun({ applicationRunId: run.applicationRunId, externalRunId: run.externalRunId, externalSessionId: session.externalSessionId });
  await adapter.getHistory({ applicationSessionId: session.applicationSessionId, externalSessionId: session.externalSessionId });
  const schedule = await adapter.createSchedule({ idempotencyKey: 'schedule-' + version, timing: { kind: 'cron', expression: '0 9 * * *', timezone: 'UTC' }, payload: { text: 'marker' } });
  await adapter.triggerSchedule({ externalScheduleId: schedule.externalScheduleId });
  await adapter.getScheduleHistory({ externalScheduleId: schedule.externalScheduleId });
  await adapter.deleteSchedule({ externalScheduleId: schedule.externalScheduleId });
  try {
    await adapter.startRun({ applicationRunId: 'bad-' + version, idempotencyKey: 'bad-' + version, session, input: { text: '', attachments: [{ kind: 'file', name: '../bad', mimeType: 'text/plain', data: Uint8Array.of(1) }] } });
    throw new Error('unsafe attachment accepted');
  } catch (error) {
    if (!(error instanceof RuntimeError) || error.code !== 'INVALID_REQUEST') throw error;
  }
  const detector = createRuntimeDetector({ dependencies, probes: [{ adapterId: 'synthetic', async probe() { return { adapterId: 'synthetic', matched: true, confidence: 1, runtimeProduct: 'synthetic', protocolName: 'synthetic', evidence: [] }; } }] });
  const detected = await detector.detect({ target: { endpoint: 'https://runtime.example.test' }, options: { allowManifest: false } });
  if (detected.status !== 'detected') throw new Error('detection failed');
  await adapter.close();
  await server.shutdown();
}
console.log('Clean package-name consumer scenarios passed.');
`;
}

function verdaccioConfig(storage, host, port) {
  return `storage: ${JSON.stringify(storage)}\nweb:\n  enable: false\nauth:\n  htpasswd:\n    file: ${JSON.stringify(join(storage, 'htpasswd'))}\nuplinks: {}\npackages:\n  '@banzae/*':\n    access: $all\n    publish: $all\n    unpublish: $all\n  '**':\n    access: $all\n    publish: $all\n    proxy: false\nlogs: { type: stdout, format: pretty, level: warn }\nlisten: ${host}:${port}\n`;
}

function assertLoopbackRegistry(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== host) throw new Error('Registry simulation must use a loopback-only HTTP URL');
}

function assertExplicitLocalPublish(args) {
  const index = args.indexOf('--registry');
  if (args[0] !== 'publish' || index < 0 || args[index + 1] !== registry) throw new Error('Every simulated publication must include the explicit local registry');
  assertLoopbackRegistry(args[index + 1]);
}

function cleanNpmEnvironment(userconfig = join(temporaryRoot, 'empty-npmrc')) {
  const env = { ...process.env, npm_config_userconfig: userconfig, NPM_CONFIG_PROVENANCE: 'false' };
  for (const key of Object.keys(env)) if (/npm.*token|node_auth_token/i.test(key)) delete env[key];
  return env;
}

async function createLocalRegistryUser(url) {
  const name = 'local-release-check';
  const response = await fetch(`${url}/-/user/org.couchdb.user:${name}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, password: 'local-only-release-check-password', email: 'local@example.invalid', type: 'user', roles: [] }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.token !== 'string' || !payload.token) throw new Error('Could not create temporary local-registry user');
  return payload.token;
}

async function availablePort(hostname) {
  return new Promise((resolve, reject) => {
    const socket = createServer();
    socket.once('error', reject);
    socket.listen(0, hostname, () => {
      const address = socket.address();
      if (!address || typeof address === 'string') return reject(new Error('Could not allocate loopback port'));
      socket.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForRegistry(url, processHandle, output) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (processHandle.exitCode != null) throw new Error(`Local registry exited early: ${output().slice(-2_000)}`);
    try { if ((await fetch(url)).status < 500) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Local registry did not become ready: ${output().slice(-2_000)}`);
}

async function run(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} failed with ${code ?? signal}`)));
  });
}

async function capture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'inherit'], ...options });
    let output = '';
    child.stdout.on('data', (chunk) => { output += String(chunk); });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve(output) : reject(new Error(`${command} failed with ${code ?? signal}`)));
  });
}
