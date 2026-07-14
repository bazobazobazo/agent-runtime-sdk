#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  executeLiveTarget,
  readLiveCliConfig,
  writeJsonAtomic,
} from './lib/live-compatibility-cli.mjs';

assert.throws(() => readLiveCliConfig('openclaw', {}, []), /disabled/i);
assert.throws(() => readLiveCliConfig('hermes', { RUNTIME_LIVE_ENABLED: 'true' }, []), /endpoint/i);
assert.throws(() => readLiveCliConfig('openclaw', {
  RUNTIME_LIVE_ENABLED: 'true', OPENCLAW_ENDPOINT: 'wss://runtime.example.test',
}, ['--token=forbidden']), /command-line/i);

const gated = readLiveCliConfig('hermes', {
  RUNTIME_LIVE_ENABLED: 'true',
  HERMES_ENDPOINT: 'https://runtime.example.test',
  LIVE_ALLOW_CHAT_RUN: 'true',
  LIVE_ALLOW_CANCELLATION: 'true',
}, []);
assert.equal(gated.mutationPolicy.allowRunCreation, false);
assert.equal(gated.mutationPolicy.allowCancellation, false);

const unresolved = readLiveCliConfig('hermes', {
  RUNTIME_LIVE_ENABLED: 'true',
  HERMES_ENDPOINT: 'https://runtime.example.test',
  HERMES_CREDENTIAL_REF: 'env:HERMES_API_TOKEN',
}, []);
await assert.rejects(() => executeLiveTarget(unresolved, { env: {}, writeReports: false }), /could not be resolved/i);

const root = await mkdtemp(join(tmpdir(), 'banzae-live-cli-'));
try {
  const path = join(root, 'report.json');
  const report = validReport();
  await writeJsonAtomic(path, report);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), report);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  await assert.rejects(() => writeJsonAtomic(path, report), (error) => error?.code === 'EEXIST');
} finally {
  await rm(root, { recursive: true, force: true });
}

process.stdout.write('Live compatibility CLI safety tests passed (7 assertions).\n');

function validReport() {
  return {
    schemaVersion: 1,
    generatedAt: '2026-07-14T00:00:00.000Z',
    evidenceType: 'sanitized-live',
    sdk: { commitSha: 'test-commit', packageVersion: '0.1.0', nodeVersion: 'v22.13.0', platform: 'linux' },
    target: { adapterId: 'fake', endpointFingerprint: 'a'.repeat(64) },
    capabilities: {
      schemaVersion: 1,
      sessions: { create: false, resume: false, history: false, fork: false },
      runs: { start: false, status: false, streamText: false, streamTools: false, cancel: false, approvals: false },
      input: { text: false, images: false, files: false },
      output: { text: false, reasoning: false, tools: false, usage: false },
      extensions: {},
    },
    checks: [],
    summary: { passed: 0, failed: 0, skipped: 0, requiredChecksPassed: true },
    limitations: [],
  };
}
