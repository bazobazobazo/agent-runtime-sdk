#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const packagesDir = new URL('../packages/', import.meta.url);
const snapshotPath = new URL('../docs/api-snapshot.md', import.meta.url);
const update = process.env.UPDATE_API_SNAPSHOT === '1';

const packageNames = (await readdir(packagesDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

let output = '# Public API Snapshot\n\n';
output += 'Generated from package declaration files. Review diffs before release.\n\n';

for (const packageName of packageNames) {
  const packageJsonPath = new URL(`../packages/${packageName}/package.json`, import.meta.url);
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  if (packageJson.private) continue;

  const distDir = new URL(`../packages/${packageName}/dist/`, import.meta.url);
  if (!existsSync(distDir)) {
    throw new Error(`Missing dist for ${packageJson.name}. Run pnpm build first.`);
  }

  output += `## ${packageJson.name}\n\n`;
  for (const file of await listFiles(distDir.pathname)) {
    if (!file.endsWith('.d.ts')) continue;
    const label = relative(distDir.pathname, file);
    output += `### ${label}\n\n`;
    output += '```ts\n';
    output += normalizeDeclarations(await readFile(file, 'utf8'));
    output += '\n```\n\n';
  }
}

if (update || !existsSync(snapshotPath)) {
  await mkdir(new URL('../docs/', import.meta.url), { recursive: true });
  await writeFile(snapshotPath, output, 'utf8');
  console.log(`updated ${snapshotPath.pathname}`);
  process.exit(0);
}

const current = await readFile(snapshotPath, 'utf8');
if (current !== output) {
  console.error('Public API snapshot is stale. Run UPDATE_API_SNAPSHOT=1 pnpm api:snapshot.');
  process.exit(1);
}

console.log('Public API snapshot is current.');

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else files.push(path);
  }
  return files.sort();
}

function normalizeDeclarations(value) {
  return value
    .replace(/\/\/# sourceMappingURL=.*$/gm, '')
    .trim();
}
