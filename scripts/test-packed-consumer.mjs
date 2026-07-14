#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = new URL('..', import.meta.url).pathname;
const temp = await mkdtemp(join(tmpdir(), 'agent-runtime-consumer-'));
const tarballs = join(temp, 'tarballs');

try {
  await mkdir(tarballs);
  const packageDirs = ['core', 'adapter-openclaw', 'adapter-hermes', 'detection', 'testing', 'node'];
  const packed = [];
  for (const directory of packageDirs) {
    const { stdout } = await exec('pnpm', ['pack', '--pack-destination', tarballs], {
      cwd: join(root, 'packages', directory),
      maxBuffer: 10 * 1024 * 1024,
    });
    const file = stdout.trim().split('\n').at(-1);
    if (!file) throw new Error(`pnpm pack produced no archive for ${directory}`);
    packed.push(file);
  }

  const localPackages = Object.fromEntries(await Promise.all(packed.map(async (path) => {
    const name = JSON.parse(await readFile(join(root, 'packages', packageDirs[packed.indexOf(path)], 'package.json'), 'utf8')).name;
    return [name, `file:${path}`];
  })));
  await writeFile(join(temp, 'package.json'), `${JSON.stringify({
    name: 'agent-runtime-sdk-consumer-check',
    private: true,
    type: 'module',
    dependencies: localPackages,
  }, null, 2)}\n`);
  await writeFile(
    join(temp, 'pnpm-workspace.yaml'),
    `packages:\n  - .\noverrides:\n${Object.entries(localPackages).map(([name, path]) => `  ${JSON.stringify(name)}: ${JSON.stringify(path)}`).join('\n')}\n`,
  );
  await exec('pnpm', ['install', '--prefer-offline', '--ignore-scripts'], { cwd: temp, maxBuffer: 20 * 1024 * 1024 });

  await writeFile(join(temp, 'consumer.ts'), `
import { RuntimeError, isRuntimeError, isTerminalRuntimeRunStatus, type AgentRuntimeAdapter, type RuntimeApprovalDecision, type RuntimeEvent } from '@banzae/agent-runtime-core';
import { createOpenClawAdapterFactory } from '@banzae/agent-runtime-openclaw';
import { createHermesAdapterFactory } from '@banzae/agent-runtime-hermes';
import { createRuntimeDetector } from '@banzae/agent-runtime-detection';
import { createRuntimeAdapterConformanceSuite } from '@banzae/agent-runtime-testing';
import { FetchHttpTransport, EnvironmentRuntimeCredentialProvider, createDefaultRuntimeRegistry } from '@banzae/agent-runtime-node';

const decision: RuntimeApprovalDecision = { action: 'allow', scope: 'once' };
const narrow = (event: RuntimeEvent) => event.type === 'assistant.delta' ? event.delta : event.eventId;
const error = new RuntimeError({ code: 'INVALID_REQUEST', message: 'safe', retryable: false });
void [decision, narrow, error, isRuntimeError(error), isTerminalRuntimeRunStatus('completed')];
void [createOpenClawAdapterFactory, createHermesAdapterFactory, createRuntimeDetector, createRuntimeAdapterConformanceSuite];
void [FetchHttpTransport, EnvironmentRuntimeCredentialProvider, createDefaultRuntimeRegistry];
declare const adapter: AgentRuntimeAdapter;
void adapter.lifecycleState;
// @ts-expect-error package export maps prohibit internal deep imports
await import('@banzae/agent-runtime-openclaw/src/protocol/types.js');
`, 'utf8');
  await writeFile(join(temp, 'tsconfig.json'), `${JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
      skipLibCheck: true, noEmit: true,
    },
    include: ['consumer.ts'],
  }, null, 2)}\n`);
  await exec(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(temp, 'tsconfig.json')], {
    cwd: temp,
    maxBuffer: 20 * 1024 * 1024,
  });

  for (const specifier of [
    '@banzae/agent-runtime-core/src/types.js',
    '@banzae/agent-runtime-openclaw/src/protocol/types.js',
    '@banzae/agent-runtime-hermes/src/schemas.js',
  ]) {
    try {
      await import(specifier);
      throw new Error(`Prohibited deep import unexpectedly resolved: ${specifier}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Prohibited deep import')) throw error;
    }
  }
  console.log(`Packed consumer compiled against ${packed.length} archives; prohibited deep imports were rejected.`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
