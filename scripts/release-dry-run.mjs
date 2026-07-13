#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const packDir = new URL('../.release-pack/', import.meta.url);
await rm(packDir, { recursive: true, force: true });
await mkdir(packDir, { recursive: true });

const packagesDir = new URL('../packages/', import.meta.url);
const packageNames = (await readdir(packagesDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const packed = [];
for (const packageName of packageNames) {
  const packageJson = JSON.parse(await readFile(new URL(`../packages/${packageName}/package.json`, import.meta.url), 'utf8'));
  if (packageJson.private) continue;
  const result = await exec('pnpm', ['--dir', `packages/${packageName}`, 'pack', '--pack-destination', packDir.pathname], {
    cwd: new URL('../', import.meta.url),
    maxBuffer: 1024 * 1024,
  });
  packed.push({ name: packageJson.name, output: result.stdout.trim() });
}

console.log(JSON.stringify({ packed }, null, 2));
