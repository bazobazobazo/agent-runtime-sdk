#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { publicPackages, root } from './lib/release-config.mjs';

const rootManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (rootManifest.license !== 'Apache-2.0') throw new Error('Root package license must be Apache-2.0.');
const allowedDependencyLicenses = new Set(['Apache-2.0', 'MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause']);
const external = new Set();
for (const pkg of await publicPackages()) {
  if (pkg.manifest.license !== rootManifest.license) throw new Error(`${pkg.name} license does not match the repository license.`);
  for (const name of Object.keys(pkg.manifest.dependencies ?? {})) if (!name.startsWith('@banzae/')) external.add(name);
}
for (const name of external) {
  const manifest = JSON.parse(await readFile(join(root, 'node_modules', name, 'package.json'), 'utf8'));
  if (!allowedDependencyLicenses.has(manifest.license)) throw new Error(`${name} has unreviewed license ${manifest.license}`);
}
console.log(`Workspace licenses are consistent; ${external.size} external production dependencies are compatible.`);
