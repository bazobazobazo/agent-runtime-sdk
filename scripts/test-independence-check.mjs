#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { publicPackages, releaseConfig, root } from './lib/release-config.mjs';

const exec = promisify(execFile);
const productWord = ['for', 'ge'].join('');
const productName = ['banzae', productWord].join('');
const consumerName = ['agent', 'hub'].join('');
const previousLibraryName = ['tele', 'graphic'].join('');
const oldDocument = join(root, 'docs', `${productName}-integration.md`);
assert.equal(existsSync(oldDocument), false);

const read = (path) => readFile(join(root, path), 'utf8');
const readme = await read('README.md');
const docsIndex = await read('docs/README.md');
const adoption = await read('docs/adapter-adoption.md');
const releaseNotes = await read('.github/release-notes-template.md');
const packageManifest = JSON.parse(await read('package.json'));
const ciWorkflow = await read('.github/workflows/ci.yml');
const releaseDryRun = await read('scripts/release-dry-run.mjs');
const releaseGate = await read('scripts/release-gate.mjs');
assert.match(readme, /Host application integration/);
assert.match(readme, /@banzae.*publisher/s);
assert.match(docsIndex, /host-application-integration\.md/);
assert.match(adoption, /Never submit the same side-effecting operation through two implementations/);
assert.match(adoption, /OUTCOME_UNKNOWN/);
assert.match(packageManifest.scripts['docs:check'], /independence:check/);
assert.match(packageManifest.scripts['package:check'], /independence:check/);
assert.match(packageManifest.scripts['package:contents'], /independence:check/);
assert.match(ciWorkflow, /pnpm independence:check/);
assert.match(releaseDryRun, /independence:check/);
assert.match(releaseGate, /independence:check/);
for (const content of [readme, docsIndex, adoption, releaseNotes]) {
  for (const term of [previousLibraryName, consumerName, ['agent', 'hub'].join(' '), productName, `banzae ${productWord}`]) {
    assert.equal(content.toLowerCase().includes(term), false);
  }
}

const expectedPackages = [
  '@banzae/agent-runtime-core',
  '@banzae/agent-runtime-detection',
  '@banzae/agent-runtime-openclaw',
  '@banzae/agent-runtime-hermes',
  '@banzae/agent-runtime-testing',
  '@banzae/agent-runtime-node',
];
assert.deepEqual(releaseConfig.publicPackages, expectedPackages);
assert.deepEqual((await publicPackages()).map((pkg) => pkg.name), expectedPackages);

for (const [path, expected] of Object.entries({
  'etc/api/public-api-inventory.json': 'e6a8b5daff26cfc1555a22d1a04618913866d2a27b4ca3fc5e9cc058f522175b',
  'docs/compatibility.md': '171fa08c2afd7867ce1d04dcdca6f5efc2d14d3dad0ced550cfcce90b25688e3',
  'docs/adapter-conformance.md': 'bd055c8a132efe9eda5f4b2ae5bc5b59bf02e0c4cb016057656dfcca7fc93dd1',
  'docs/live-compatibility.md': '4c1999983596b0ded7cade07df530a958c9f9df869892bf77dc7e326c370da0d',
})) {
  const digest = createHash('sha256').update(await readFile(join(root, path))).digest('hex');
  assert.equal(digest, expected, `${path} changed without updating the reviewed release invariant`);
}

const directory = await mkdtemp(join(tmpdir(), 'agent-runtime-independence-'));
try {
  for (const [index, term] of [
    previousLibraryName,
    ['@', previousLibraryName, '-dev/openclaw-gateway-client'].join(''),
    consumerName,
    ['agent', 'hub'].join(' '),
    productName,
    ['banzae', productWord].join(' '),
  ].entries()) {
    const prohibited = join(directory, `prohibited-${index}.txt`);
    await writeFile(prohibited, term.toUpperCase(), 'utf8');
    await assert.rejects(
      () => exec(process.execPath, ['./scripts/check-independence.mjs', prohibited], { cwd: root }),
      (error) => String(error?.stderr).includes('Product-independence check failed'),
    );
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log('Product-independence navigation, branding, migration, package, and negative-path tests passed.');
