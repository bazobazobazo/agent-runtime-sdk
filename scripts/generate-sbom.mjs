#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  artifactRoot,
  publicPackages,
  readJson,
  releaseConfig,
  sourceDate,
  writeJsonAtomic,
} from './lib/release-config.mjs';

const lock = await readFile(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');
const lockDigest = createHash('sha256').update(lock).digest('hex');
const sdkPackages = await publicPackages();
const packages = sdkPackages.map((pkg) => ({
  SPDXID: `SPDXRef-${pkg.name.replace(/[^A-Za-z0-9.-]/g, '-')}`,
  name: pkg.name,
  versionInfo: releaseConfig.sdkVersion,
  downloadLocation: 'NOASSERTION',
  filesAnalyzed: false,
  licenseConcluded: 'Apache-2.0',
  licenseDeclared: 'Apache-2.0',
  copyrightText: 'Copyright 2026 Banzae',
}));
const externalNames = new Set();
for (const pkg of sdkPackages) {
  for (const name of Object.keys(pkg.manifest.dependencies ?? {})) {
    if (!releaseConfig.publicPackages.includes(name)) externalNames.add(name);
  }
}
for (const name of [...externalNames].sort()) {
  const dependencyManifest = await readJson(new URL(`../node_modules/${name}/package.json`, import.meta.url));
  packages.push({
    SPDXID: `SPDXRef-${name.replace(/[^A-Za-z0-9.-]/g, '-')}`,
    name,
    versionInfo: dependencyManifest.version,
    downloadLocation: 'NOASSERTION',
    filesAnalyzed: false,
    licenseConcluded: dependencyManifest.license ?? 'NOASSERTION',
    licenseDeclared: dependencyManifest.license ?? 'NOASSERTION',
    copyrightText: 'NOASSERTION',
  });
}

const relationships = [];
for (const pkg of sdkPackages) {
  const source = `SPDXRef-${pkg.name.replace(/[^A-Za-z0-9.-]/g, '-')}`;
  for (const name of Object.keys(pkg.manifest.dependencies ?? {})) {
    relationships.push({
      spdxElementId: source,
      relationshipType: 'DEPENDS_ON',
      relatedSpdxElement: `SPDXRef-${name.replace(/[^A-Za-z0-9.-]/g, '-')}`,
    });
  }
}

const doc = {
  spdxVersion: 'SPDX-2.3',
  dataLicense: 'CC0-1.0',
  SPDXID: 'SPDXRef-DOCUMENT',
  name: `agent-runtime-sdk-${releaseConfig.sdkVersion}-sbom`,
  documentNamespace: `https://banzae.dev/sbom/agent-runtime-sdk/${releaseConfig.sdkVersion}/${lockDigest.slice(0, 16)}`,
  creationInfo: { created: sourceDate(), creators: ['Tool: scripts/generate-sbom.mjs'] },
  packages,
  relationships,
};
await mkdir(join(artifactRoot, 'sbom'), { recursive: true });
await writeJsonAtomic(join(artifactRoot, 'sbom', 'repository.spdx.json'), doc);
console.log(`Wrote release SBOM with ${packages.length} packages.`);
