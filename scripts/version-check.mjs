#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  privatePackageNames,
  publicPackageNames,
  publicPackages,
  readJson,
  releaseConfig,
  root,
} from './lib/release-config.mjs';

if (!/^0\.1\.0-alpha\.1$/.test(releaseConfig.sdkVersion)) throw new Error('Target SDK version must be 0.1.0-alpha.1.');
if (publicPackageNames.size !== 6) throw new Error('Exactly six public packages must release together.');
const packages = await publicPackages();
for (const pkg of packages) {
  if (pkg.manifest.private) throw new Error(`${pkg.name} must be publishable.`);
  if (pkg.manifest.version !== releaseConfig.sourceVersion) throw new Error(`${pkg.name} source version is not synchronized.`);
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, range] of Object.entries(pkg.manifest[field] ?? {})) {
      if (publicPackageNames.has(name) && range !== `workspace:${releaseConfig.sourceVersion}`) {
        throw new Error(`${pkg.name} ${field}.${name} must use the exact workspace source version.`);
      }
    }
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
const pending = await readFile(join(root, '.changeset', 'initial-alpha-packages.md'), 'utf8');
for (const name of publicPackageNames) if (!pending.includes(`"${name}"`)) throw new Error(`Initial alpha changeset omits ${name}.`);
for (const name of privatePackageNames) if (pending.includes(name)) throw new Error(`Initial alpha changeset includes private package ${name}.`);

console.log(`Version policy valid: ${packages.length} packages remain at ${releaseConfig.sourceVersion}; release plan targets ${releaseConfig.sdkVersion}.`);
