#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  artifactRoot,
  assertSafeRelativePath,
  privatePackageNames,
  publicPackageNames,
  readJson,
  releaseConfig,
  sha256File,
} from './lib/release-config.mjs';

const exec = promisify(execFile);
const manifest = await readJson(join(artifactRoot, 'release-manifest.json'));
if (manifest.schemaVersion !== 1 || manifest.sdkVersion !== releaseConfig.sdkVersion) throw new Error('Release manifest schema/version mismatch.');
if (manifest.publicationStatus !== 'not-published') throw new Error('Release artifacts must remain not-published.');
if (manifest.packages.length !== 6) throw new Error('Release manifest must contain six packages.');
if (new Set(manifest.packages.map((pkg) => pkg.name)).size !== 6) throw new Error('Release manifest package names are not unique.');
for (const pkg of manifest.packages) {
  if (!publicPackageNames.has(pkg.name) || privatePackageNames.has(pkg.name)) throw new Error(`Invalid release package ${pkg.name}`);
  if (pkg.version !== releaseConfig.sdkVersion) throw new Error(`${pkg.name} release version mismatch.`);
  assertSafeRelativePath(pkg.tarball, `${pkg.name} tarball`);
  const path = join(artifactRoot, pkg.tarball);
  if (await sha256File(path) !== pkg.sha256) throw new Error(`${pkg.name} checksum mismatch.`);
  const budget = releaseConfig.packageBudgets[pkg.name];
  if (pkg.sizeBytes > budget.maxSizeBytes || pkg.fileCount > budget.maxFiles) throw new Error(`${pkg.name} exceeds archive budget.`);
  const packedManifest = JSON.parse((await exec('tar', ['-xOf', path, 'package/package.json'])).stdout);
  if (packedManifest.version !== releaseConfig.sdkVersion) throw new Error(`${pkg.name} packed version mismatch.`);
  if (JSON.stringify(packedManifest).includes('workspace:')) throw new Error(`${pkg.name} contains workspace protocol.`);
  const archiveFiles = (await exec('tar', ['-tzf', path])).stdout.trim().split('\n');
  const prohibitedNames = /(^|\/)(?:\.env(?:\.|$)|coverage|tests?|fixtures|src|\.git)(?:\/|$)/i;
  const allowedExtensions = /(?:\.js|\.d\.ts|\.map|\.json|\.md|LICENSE)$/;
  for (const entry of archiveFiles) {
    if (prohibitedNames.test(entry)) throw new Error(`${pkg.name} contains prohibited archive path ${entry}`);
    if (!entry.endsWith('/') && !allowedExtensions.test(entry)) throw new Error(`${pkg.name} contains unapproved file type ${entry}`);
    if (!entry.endsWith('/')) {
      const body = (await exec('tar', ['-xOf', path, entry], { maxBuffer: 20 * 1024 * 1024 })).stdout;
      if (/\/home\/(?!runtime(?:\/|['"]|$))|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|(?:api[_-]?key|password)\s*[:=]\s*["'][^"']+/i.test(body)) {
        throw new Error(`${pkg.name} contains an absolute path or credential-like content in ${entry}`);
      }
    }
  }
}
assertSafeRelativePath(manifest.sbom, 'SBOM');
const serialized = JSON.stringify(manifest);
if (serialized.includes('/home/') || serialized.includes('\\\\') || /token|password|private.?key/i.test(serialized)) {
  throw new Error('Release manifest contains an absolute path or credential-like field.');
}
const checksums = await readFile(join(artifactRoot, 'SHA256SUMS'), 'utf8');
if (checksums.trim().split('\n').length !== 6) throw new Error('SHA256SUMS must contain six entries.');
const sbom = await readJson(join(artifactRoot, manifest.sbom));
if (sbom.spdxVersion !== 'SPDX-2.3' || sbom.packages.length < 6) throw new Error('Release SBOM is invalid.');
for (const path of [
  ...manifest.apiReports,
  ...manifest.compatibilityEvidence.map((entry) => entry.path),
  ...manifest.documents.map((entry) => entry.path),
]) {
  assertSafeRelativePath(path, 'Release evidence');
  await readFile(join(artifactRoot, path));
}
const index = await readJson(join(artifactRoot, 'artifact-index.json'));
if (index.schemaVersion !== 1 || index.artifacts.length < 20) throw new Error('Release artifact index is incomplete.');
for (const entry of index.artifacts) {
  assertSafeRelativePath(entry.path, 'Artifact index path');
  if (!entry.purpose || /\/home\/|token|password|private.?key/i.test(entry.path)) throw new Error('Artifact index contains unsafe metadata.');
  await readFile(join(artifactRoot, entry.path));
}
console.log(`Validated release manifest, SBOM, checksums, and ${manifest.packages.length} tarballs.`);
