#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  artifactRoot,
  cleanArtifactRoot,
  publicPackages,
  releaseConfig,
  stagePublicPackage,
  tarballName,
  writeJsonAtomic,
} from './lib/release-config.mjs';

const exec = promisify(execFile);
if (!process.argv.includes('--keep')) await cleanArtifactRoot();
const stagingRoot = join(artifactRoot, '.staging');
const tarballRoot = join(artifactRoot, 'tarballs');
await mkdir(stagingRoot, { recursive: true });
await mkdir(tarballRoot, { recursive: true });
const results = [];

for (const pkg of await publicPackages()) {
  const stage = await stagePublicPackage(pkg, stagingRoot);
  const { stdout } = await exec('npm', ['pack', '--json', '--pack-destination', tarballRoot], {
    cwd: stage,
    env: { ...process.env, npm_config_ignore_scripts: 'true' },
    maxBuffer: 20 * 1024 * 1024,
  });
  const report = JSON.parse(stdout)[0];
  const expected = tarballName(pkg.name);
  if (report.filename !== expected) throw new Error(`${pkg.name} produced ${report.filename}; expected ${expected}`);
  const budget = releaseConfig.packageBudgets[pkg.name];
  if (!budget) throw new Error(`No archive budget configured for ${pkg.name}`);
  if (report.size > budget.maxSizeBytes) throw new Error(`${pkg.name} archive exceeds ${budget.maxSizeBytes} bytes`);
  if (report.entryCount > budget.maxFiles) throw new Error(`${pkg.name} archive exceeds ${budget.maxFiles} files`);
  const paths = report.files.map((file) => file.path).sort();
  for (const required of ['LICENSE', 'README.md', 'CHANGELOG.md', 'THIRD_PARTY_NOTICES.md', 'package.json', 'dist/index.js', 'dist/index.d.ts']) {
    if (!paths.includes(required)) throw new Error(`${pkg.name} archive is missing ${required}`);
  }
  for (const path of paths) {
    if (!/^(?:LICENSE|README\.md|CHANGELOG\.md|THIRD_PARTY_NOTICES\.md|package\.json|dist\/.+\.(?:js|map|d\.ts))$/.test(path)) {
      throw new Error(`${pkg.name} archive includes unapproved file ${path}`);
    }
  }
  const packedManifest = JSON.parse((await exec('tar', ['-xOf', join(tarballRoot, report.filename), 'package/package.json'])).stdout);
  if (JSON.stringify(packedManifest).includes('workspace:')) throw new Error(`${pkg.name} archive contains unresolved workspace range`);
  results.push({
    name: pkg.name,
    version: report.version,
    tarball: `tarballs/${report.filename}`,
    sizeBytes: report.size,
    unpackedSizeBytes: report.unpackedSize,
    fileCount: report.entryCount,
    files: paths,
  });
}

await rm(stagingRoot, { recursive: true, force: true });
await writeJsonAtomic(join(artifactRoot, 'pack-results.json'), { schemaVersion: 1, packages: results });
console.log(`Packed ${results.length} public packages for ${releaseConfig.sdkVersion}.`);
