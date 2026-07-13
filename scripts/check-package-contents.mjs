#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const packagesDir = new URL('../packages/', import.meta.url);
const allowedFiles = new Set(['dist', 'README.md', 'LICENSE', 'package.json']);
const packageNames = (await readdir(packagesDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

for (const packageName of packageNames) {
  const packageJsonPath = new URL(`../packages/${packageName}/package.json`, import.meta.url);
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  if (packageJson.private) continue;

  if (!Array.isArray(packageJson.files) || packageJson.files.length === 0) {
    throw new Error(`${packageJson.name} must define a package files allowlist.`);
  }
  for (const file of packageJson.files) {
    if (!allowedFiles.has(file)) throw new Error(`${packageJson.name} publishes unexpected file entry: ${file}`);
  }
  if (!existsSync(new URL(`../packages/${packageName}/README.md`, import.meta.url))) {
    throw new Error(`${packageJson.name} is missing README.md.`);
  }
  if (!existsSync(new URL(`../packages/${packageName}/dist/index.js`, import.meta.url))) {
    throw new Error(`${packageJson.name} is missing dist/index.js. Run pnpm build first.`);
  }
  if (!existsSync(new URL(`../packages/${packageName}/dist/index.d.ts`, import.meta.url))) {
    throw new Error(`${packageJson.name} is missing dist/index.d.ts. Run pnpm build first.`);
  }
}

console.log('Package content allowlists look safe.');
