#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  artifactRoot,
  publicPackages,
  readJson,
  relativeArtifact,
  releaseConfig,
  releaseManifestFor,
  sha256File,
  sourceDate,
  writeJsonAtomic,
  writeTextAtomic,
} from './lib/release-config.mjs';

const exec = promisify(execFile);
const packs = await readJson(join(artifactRoot, 'pack-results.json'));
const sbomPath = join(artifactRoot, 'sbom', 'repository.spdx.json');
const commitSha = (await exec('git', ['rev-parse', 'HEAD'], { cwd: new URL('..', import.meta.url).pathname })).stdout.trim();
const packages = [];
const checksumLines = [];
for (const entry of packs.packages) {
  const path = join(artifactRoot, entry.tarball);
  const sha256 = await sha256File(path);
  checksumLines.push(`${sha256}  ${entry.tarball}`);
  packages.push({
    name: entry.name,
    version: entry.version,
    tarball: entry.tarball,
    sha256,
    sizeBytes: entry.sizeBytes,
    fileCount: entry.fileCount,
  });
}
await writeTextAtomic(join(artifactRoot, 'SHA256SUMS'), `${checksumLines.sort().join('\n')}\n`);

const apiSource = new URL('../etc/api/', import.meta.url);
const apiOutput = join(artifactRoot, 'api');
await mkdir(apiOutput, { recursive: true });
const apiReports = (await readdir(apiSource))
  .filter((name) => name.endsWith('.api.md') || name === 'public-api-inventory.json')
  .sort();
for (const name of apiReports) await cp(new URL(name, apiSource), join(apiOutput, name));

const compatibilityOutput = join(artifactRoot, 'compatibility');
await mkdir(compatibilityOutput, { recursive: true });
for (const name of ['compatibility.md', 'adapter-conformance.md', 'live-compatibility.md']) {
  await cp(new URL(`../docs/${name}`, import.meta.url), join(compatibilityOutput, name));
}
const manifest = {
  schemaVersion: 1,
  sdkVersion: releaseConfig.sdkVersion,
  commitSha,
  packages,
  sbom: relativeArtifact(sbomPath),
  apiReports: apiReports.map((name) => `api/${name}`),
  compatibilityEvidence: [
    { classification: 'fixture', path: 'compatibility/compatibility.md' },
    { classification: 'fake-server-conformance', path: 'compatibility/adapter-conformance.md' },
    { classification: 'sanitized-live-where-recorded', path: 'compatibility/live-compatibility.md' },
    { classification: 'hermes-full-live-pending', path: 'compatibility/compatibility.md' }
  ],
  generatedAt: sourceDate(),
  publicationStatus: 'not-published',
};
await writeJsonAtomic(join(artifactRoot, 'release-manifest.json'), manifest);

const packageMetadata = (await publicPackages()).map((pkg) => {
  const releaseManifest = releaseManifestFor(pkg.manifest);
  return {
    name: pkg.name,
    sourceVersion: pkg.manifest.version,
    releaseVersion: releaseConfig.sdkVersion,
    license: pkg.manifest.license,
    directory: `packages/${pkg.directory}`,
    dependencies: releaseManifest.dependencies ?? {},
    peerDependencies: releaseManifest.peerDependencies ?? {},
  };
});
await writeJsonAtomic(join(artifactRoot, 'package-metadata.json'), { schemaVersion: 1, packages: packageMetadata });
await writeJsonAtomic(join(artifactRoot, 'dependency-inventory.json'), {
  schemaVersion: 1,
  packages: packageMetadata.map(({ name, dependencies, peerDependencies }) => ({ name, dependencies, peerDependencies })),
  acceptedRisks: [],
});
const template = await readFile(new URL('../.github/release-notes-template.md', import.meta.url), 'utf8');
await writeTextAtomic(join(artifactRoot, 'release-notes-preview.md'), template.replaceAll('{{VERSION}}', releaseConfig.sdkVersion));
console.log(`Generated checksums and release manifest for ${packages.length} packages.`);
