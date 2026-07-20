#!/usr/bin/env node
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  privatePackageNames,
  publicPackageNames,
  publicPackages,
  readJson,
  releaseManifestFor,
  releaseConfig,
  root,
} from './lib/release-config.mjs';

if (!/^0\.1\.0-alpha\.2$/.test(releaseConfig.sdkVersion)) throw new Error('Target SDK version must be 0.1.0-alpha.2.');
if (publicPackageNames.size !== 6) throw new Error('Exactly six public packages must release together.');
const workspaceManifests = [];
for (const entry of await readdir(join(root, 'packages'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const manifestPath = join(root, 'packages', entry.name, 'package.json');
  try {
    workspaceManifests.push(await readJson(manifestPath));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}
const configuredNames = new Set([...publicPackageNames, ...privatePackageNames]);
if (workspaceManifests.length !== configuredNames.size) throw new Error('Release configuration does not enumerate every workspace package.');
for (const manifest of workspaceManifests) {
  if (!configuredNames.has(manifest.name)) throw new Error(`Unclassified workspace package ${manifest.name}.`);
  if (privatePackageNames.has(manifest.name) && manifest.private !== true) throw new Error(`${manifest.name} must remain private.`);
}
const packages = await publicPackages();
for (const pkg of packages) {
  if (pkg.manifest.private) throw new Error(`${pkg.name} must be publishable.`);
  if (pkg.manifest.version !== releaseConfig.sdkVersion) throw new Error(`${pkg.name} release version is not synchronized.`);
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, range] of Object.entries(pkg.manifest[field] ?? {})) {
      if (publicPackageNames.has(name) && range !== `workspace:${releaseConfig.sdkVersion}`) {
        throw new Error(`${pkg.name} ${field}.${name} must use the exact workspace release version.`);
      }
    }
  }
  const packed = releaseManifestFor(pkg.manifest);
  if (packed.version !== releaseConfig.sdkVersion || JSON.stringify(packed).includes('workspace:')) {
    throw new Error(`${pkg.name} packed metadata does not resolve to the exact release version.`);
  }
}

for (const name of privatePackageNames) {
  const suffix = name.replace('@banzae/agent-runtime-', '');
  const directory = suffix === 'adapter-template' ? suffix : `adapter-${suffix}`;
  const manifest = await readJson(join(root, 'packages', directory, 'package.json'));
  if (manifest.private !== true) throw new Error(`${name} must remain private.`);
  if (manifest.publishConfig || manifest.exports || manifest.files) throw new Error(`${name} exposes publication metadata.`);
}

const changesets = await readJson(join(root, '.changeset', 'config.json'));
const fixed = changesets.fixed?.[0] ?? [];
if (fixed.length !== 6 || fixed.some((name) => !publicPackageNames.has(name))) {
  throw new Error('Changesets fixed group must contain exactly the six public packages.');
}
if ((changesets.ignore ?? []).some((name) => publicPackageNames.has(name))) throw new Error('A public package is ignored by Changesets.');
const pending = (await readdir(join(root, '.changeset'))).filter((name) => name.endsWith('.md') && name !== 'README.md');
if (pending.length) throw new Error(`Release changesets were not consumed: ${pending.join(', ')}`);

console.log(`Version policy valid: ${packages.length} public packages are synchronized at ${releaseConfig.sdkVersion}; private packages are excluded.`);
