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
const commitSha = process.env.RELEASE_COMMIT_SHA
  ?? (await exec('git', ['rev-parse', 'HEAD'], { cwd: new URL('..', import.meta.url).pathname })).stdout.trim();
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
const documentsOutput = join(artifactRoot, 'documents');
await mkdir(documentsOutput, { recursive: true });
const documents = [
  { type: 'known-limitations', source: 'known-limitations.md', output: 'known-limitations.md' },
  { type: 'migration-summary', source: 'release-migration-summary.md', output: 'migration-summary.md' },
  { type: 'security-summary', source: 'release-security-summary.md', output: 'security-summary.md' },
  { type: 'operator-prerequisites', source: 'release-operator-checklist.md', output: 'operator-prerequisites.md' },
  { type: 'validation-report', source: 'release-validation-report.md', output: 'validation-report.md' },
];
for (const document of documents) {
  await cp(new URL(`../docs/${document.source}`, import.meta.url), join(documentsOutput, document.output));
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
  documents: documents.map(({ type, output }) => ({ type, path: `documents/${output}` })),
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
await writeJsonAtomic(join(artifactRoot, 'artifact-index.json'), {
  schemaVersion: 1,
  artifacts: [
    { path: 'artifact-index.json', purpose: 'Inventory and purpose of every staged release artifact.' },
    { path: 'release-manifest.json', purpose: 'Versioned release identity, packages, evidence, and publication status.' },
    { path: 'SHA256SUMS', purpose: 'SHA-256 checksums for all six package archives.' },
    { path: 'sbom/repository.spdx.json', purpose: 'SPDX 2.3 release dependency bill of materials.' },
    { path: 'package-metadata.json', purpose: 'Normalized public package metadata and dependency ranges.' },
    { path: 'dependency-inventory.json', purpose: 'Production dependency inventory and accepted-risk record.' },
    { path: 'pack-results.json', purpose: 'Tarball file, size, count, and budget inspection results.' },
    { path: 'release-notes-preview.md', purpose: 'Candidate release notes for human review.' },
    ...apiReports.map((name) => ({ path: `api/${name}`, purpose: 'Frozen public API report.' })),
    { path: 'compatibility/compatibility.md', purpose: 'Evidence-based runtime compatibility matrix.' },
    { path: 'compatibility/adapter-conformance.md', purpose: 'Shared fake-server conformance evidence.' },
    { path: 'compatibility/live-compatibility.md', purpose: 'Live-validation safety and evidence policy.' },
    ...documents.map(({ type, output }) => ({ path: `documents/${output}`, purpose: `Release ${type.replaceAll('-', ' ')}.` })),
    ...packages.map((pkg) => ({ path: pkg.tarball, purpose: `Candidate archive for ${pkg.name}.` })),
  ],
});
console.log(`Generated checksums and release manifest for ${packages.length} packages.`);
