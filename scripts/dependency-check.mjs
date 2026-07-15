#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { builtinModules } from 'node:module';
import { publicPackages, publicPackageNames } from './lib/release-config.mjs';

const builtin = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
for (const pkg of await publicPackages()) {
  const declared = new Set([
    ...Object.keys(pkg.manifest.dependencies ?? {}),
    ...Object.keys(pkg.manifest.peerDependencies ?? {}),
    ...Object.keys(pkg.manifest.optionalDependencies ?? {}),
  ]);
  for (const file of await sourceFiles(join(pkg.path, 'src'))) {
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(/(?:from\s+|import\s*\()(['"])([^'".][^'"]*)\1/g)) {
      const specifier = match[2];
      const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
      if (name === pkg.name || builtin.has(name) || builtin.has(specifier)) continue;
      if (!declared.has(name)) throw new Error(`${pkg.name} imports undeclared runtime dependency ${specifier}`);
    }
  }
  for (const [name, range] of Object.entries(pkg.manifest.dependencies ?? {})) {
    if (publicPackageNames.has(name) && range !== `workspace:${pkg.manifest.version}`) throw new Error(`${pkg.name} has incompatible internal range for ${name}`);
  }
}
console.log('Production dependency declarations and internal ranges are consistent.');

async function sourceFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await sourceFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) output.push(path);
  }
  return output;
}
