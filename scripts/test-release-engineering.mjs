#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { artifactRoot, distTagForVersion, publicPackages, readJson, releaseConfig, root } from './lib/release-config.mjs';

const exec = promisify(execFile);
assert.equal(releaseConfig.publicPackages.length, 6);
assert.equal(new Set(releaseConfig.publicPackages).size, 6);
assert.equal(releaseConfig.sdkVersion, '0.1.0-alpha.2');
assert.equal(releaseConfig.distTags.prerelease, 'next');
assert.equal(releaseConfig.distTags.stable, 'latest');
assert.equal(distTagForVersion(releaseConfig.sdkVersion), 'next');
assert.equal(distTagForVersion('1.0.0'), 'latest');
for (const pkg of await publicPackages()) {
  assert.equal(pkg.manifest.private, undefined);
  assert.equal(pkg.manifest.version, releaseConfig.sdkVersion);
  assert.equal(pkg.manifest.license, 'Apache-2.0');
  assert.equal(pkg.manifest.engines.node, '>=22.13');
  assert.equal(pkg.manifest.publishConfig.access, 'public');
  assert.equal(pkg.manifest.publishConfig.provenance, true);
  assert.equal(pkg.manifest.sideEffects, false);
}
for (const name of releaseConfig.privatePackages) {
  const suffix = name.replace('@banzae/agent-runtime-', '');
  const directory = suffix === 'adapter-template' ? suffix : `adapter-${suffix}`;
  const manifest = await readJson(join(root, 'packages', directory, 'package.json'));
  assert.equal(manifest.private, true);
  assert.equal(manifest.publishConfig, undefined);
  assert.equal(manifest.exports, undefined);
}
const dryRun = await readFile(join(root, 'scripts', 'release-dry-run.mjs'), 'utf8');
assert.doesNotMatch(dryRun, /npm\s+publish|pnpm\s+publish|npm\s+dist-tag|git\s+tag|gh\s+release\s+create/);
assert.match(dryRun, /with dist-tag \$\{manifest\.distTag\}/);
const workflow = await readFile(join(root, '.github', 'workflows', 'release.yml'), 'utf8');
assert.match(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|NPM_TOKEN/);
assert.equal((workflow.match(/id-token:\s*write/g) ?? []).length, 1);
const publishLines = workflow.split(/\r?\n/).filter((line) => /\bnpm\s+publish\b/.test(line));
assert.ok(publishLines.length > 0);
for (const line of publishLines) assert.match(line, /--tag\s+next\b/);
assert.match(workflow, /node-version:\s*['"]22\.14\.0['"]/);
assert.match(workflow, /npm install --global npm@11\.5\.1/);
assert.match(workflow, /const minimum = \[22, 14, 0\]/);
assert.match(workflow, /const minimum = \[11, 5, 1\]/);
assert.match(workflow, /package-manager-cache:\s*['"]false['"]/);
await exec(process.execPath, ['./scripts/validate-release-artifacts.mjs'], { cwd: root, maxBuffer: 20 * 1024 * 1024 });
const manifest = await readJson(join(artifactRoot, 'release-manifest.json'));
assert.equal(manifest.publicationStatus, 'not-published');
assert.equal(manifest.distTag, 'next');
assert.equal(manifest.packages.length, 6);
const bootstrapDocs = await readFile(join(root, 'docs', 'releasing.md'), 'utf8');
assert.match(bootstrapDocs, /immediately revoke/i);
assert.match(bootstrapDocs, /OIDC.*required|must use.*OIDC/is);
assert.match(bootstrapDocs, /bazobazobazo/);
assert.match(bootstrapDocs, /workflow filename.*release\.yml/is);
console.log('Release-engineering policy, workflow, private exclusions, and generated artifacts passed tests.');
