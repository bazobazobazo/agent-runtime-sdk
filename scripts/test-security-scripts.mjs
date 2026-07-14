#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), 'agent-runtime-fixture-security-'));
try {
  await writeFile(join(directory, 'malicious.json'), JSON.stringify({
    metadata: { source: 'synthetic', fixtureSchemaVersion: 1, validatedRuntimeVersion: null },
    payload: { authorization: `Bearer ${'malicious-fixture-secret-marker'}` },
  }));
  await assert.rejects(
    () => exec(process.execPath, ['./scripts/validate-fixtures.mjs', directory], { cwd: new URL('../', import.meta.url).pathname }),
    (error) => String(error?.stderr).includes('bearer credential'),
  );
  process.stdout.write('Security script negative-path tests passed.\n');
} finally {
  await rm(directory, { recursive: true, force: true });
}
