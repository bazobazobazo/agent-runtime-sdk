#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';

const root = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
if (root.license !== 'Apache-2.0') throw new Error('Root package license must be Apache-2.0.');
for (const entry of await readdir(new URL('../packages/', import.meta.url), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const pkg = JSON.parse(await readFile(new URL(`../packages/${entry.name}/package.json`, import.meta.url), 'utf8'));
  if (pkg.private) continue;
  if (pkg.license !== root.license) throw new Error(`${pkg.name} license does not match the repository license.`);
}
process.stdout.write('Workspace package licenses are consistent.\n');
