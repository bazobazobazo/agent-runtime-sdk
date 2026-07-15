#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const packagesDir = new URL('../packages/', import.meta.url);
const allowedFiles = new Set(['dist', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']);
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
  for (const required of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    const packageFile = new URL(`../packages/${packageName}/${required}`, import.meta.url);
    if (!existsSync(packageFile)) throw new Error(`${packageJson.name} is missing ${required}.`);
    const rootFile = new URL(`../${required}`, import.meta.url);
    if (await readFile(packageFile, 'utf8') !== await readFile(rootFile, 'utf8')) throw new Error(`${packageJson.name} ${required} is stale.`);
  }
  if (!existsSync(new URL(`../packages/${packageName}/dist/index.js`, import.meta.url))) {
    throw new Error(`${packageJson.name} is missing dist/index.js. Run pnpm build first.`);
  }
  if (!existsSync(new URL(`../packages/${packageName}/dist/index.d.ts`, import.meta.url))) {
    throw new Error(`${packageJson.name} is missing dist/index.d.ts. Run pnpm build first.`);
  }
  for (const file of await listFiles(new URL(`../packages/${packageName}/dist/`, import.meta.url))) {
    if (!/\.(?:js|map|d\.ts)$/.test(file)) throw new Error(`${packageJson.name} dist contains unsupported file ${file}`);
    const text = await readFile(new URL(`../packages/${packageName}/dist/${file}`, import.meta.url), 'utf8');
    if (/\/home\/(?!runtime(?:\/|['"]|$))/.test(text) || text.includes('workspace:')) {
      throw new Error(`${packageJson.name} dist leaks local/workspace data in ${file}`);
    }
  }
}

console.log('Package content allowlists look safe.');

async function listFiles(directory, prefix = '') {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) output.push(...await listFiles(new URL(`${entry.name}/`, directory), name));
    else output.push(name);
  }
  return output;
}
