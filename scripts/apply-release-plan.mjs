#!/usr/bin/env node
import { readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  exists,
  publicPackageNames,
  publicPackages,
  releaseConfig,
  root,
  writeJsonAtomic,
  writeTextAtomic,
} from './lib/release-config.mjs';

const target = releaseConfig.sdkVersion;
const changesetPath = join(root, '.changeset', 'initial-alpha-packages.md');
if (!await exists(changesetPath)) {
  const applied = (await publicPackages()).every((pkg) => pkg.manifest.version === target);
  if (applied && releaseConfig.sourceVersion === target) {
    console.log(`Release plan ${target} is already applied and its Changeset is consumed.`);
    process.exit(0);
  }
  throw new Error('The reviewed initial alpha changeset is missing before the release plan was fully applied.');
}
const changeset = await readFile(changesetPath, 'utf8');
const packages = await publicPackages();
for (const pkg of packages) {
  if (!changeset.includes(`"${pkg.name}"`)) throw new Error(`Reviewed changeset omits ${pkg.name}.`);
  if (pkg.manifest.version !== releaseConfig.sourceVersion) {
    throw new Error(`${pkg.name} is ${pkg.manifest.version}; expected source version ${releaseConfig.sourceVersion}.`);
  }
  const manifest = structuredClone(pkg.manifest);
  manifest.version = target;
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (publicPackageNames.has(name)) manifest[field][name] = `workspace:${target}`;
    }
  }
  if (!manifest.files.includes('CHANGELOG.md')) manifest.files.splice(2, 0, 'CHANGELOG.md');
  await writeJsonAtomic(join(pkg.path, 'package.json'), manifest);
  await writeTextAtomic(join(pkg.path, 'CHANGELOG.md'), `# Changelog\n\n## ${target} — release candidate\n\n- Initial synchronized pre-alpha release candidate.\n- See the repository changelog and release notes for features, security posture, migration guidance, and known limitations.\n`);
}

const pending = (await readdir(join(root, '.changeset'))).filter((name) => name.endsWith('.md') && name !== 'README.md');
if (pending.length !== 1 || pending[0] !== 'initial-alpha-packages.md') {
  throw new Error(`Unexpected pending changesets: ${pending.join(', ')}`);
}
await writeJsonAtomic(join(root, 'release.config.json'), { ...releaseConfig, sourceVersion: target });
await rm(changesetPath);
console.log(`Applied ${target} to ${packages.length} synchronized public packages and consumed ${pending[0]}.`);
