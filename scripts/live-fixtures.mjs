#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validateLiveFixtureCandidate } from '../packages/testing/dist/index.js';

const root = resolve(process.argv[2] ?? process.env.LIVE_OUTPUT_DIR ?? 'artifacts/live-compatibility/fixture-candidates');
try {
  const files = (await readdir(root)).filter((name) => name.endsWith('.candidate.json')).sort();
  if (files.length === 0) throw new Error('No live fixture candidates found');
  for (const file of files) validateLiveFixtureCandidate(JSON.parse(await readFile(join(root, file), 'utf8')));
  process.stdout.write(`Validated ${files.length} sanitized live fixture candidate(s); manual review remains required.\n`);
} catch {
  process.stderr.write('LIVE_FIXTURE_VALIDATION_FAILED: fixture candidates failed safe validation\n');
  process.exitCode = 1;
}
