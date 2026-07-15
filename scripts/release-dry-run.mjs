#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { artifactRoot, readJson, root } from './lib/release-config.mjs';

const exec = promisify(execFile);
const commands = [
  ['pnpm', ['version:check']],
  ['pnpm', ['clean']],
  ['pnpm', ['build']],
  ['pnpm', ['api:extract']],
  ['pnpm', ['api:check']],
  ['pnpm', ['package:check']],
  ['pnpm', ['package:contents']],
  [process.execPath, ['./scripts/prepare-release-packages.mjs']],
  [process.execPath, ['./scripts/test-packed-consumer.mjs', '--use-existing']],
  ['pnpm', ['sbom:generate']],
  [process.execPath, ['./scripts/generate-release-manifest.mjs']],
  [process.execPath, ['./scripts/validate-release-artifacts.mjs']],
  ['pnpm', ['secret:scan']],
  ['pnpm', ['artifact:scan']],
  ['pnpm', ['provenance:check']],
  ['pnpm', ['release:plan']],
];

for (const [command, args] of commands) {
  console.log(`$ ${command} ${args.join(' ')}`);
  const result = await exec(command, args, { cwd: root, maxBuffer: 50 * 1024 * 1024 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

const manifest = await readJson(`${artifactRoot}/release-manifest.json`);
if (manifest.publicationStatus !== 'not-published') throw new Error('Dry run changed publication status.');
const forbiddenCommands = [
  ['npm', 'publish'],
  ['pnpm', 'publish'],
  ['gh', 'release', 'create'],
].map((parts) => parts.join(' '));
for (const path of ['./scripts/release-dry-run.mjs', './scripts/prepare-release-packages.mjs', './scripts/generate-release-manifest.mjs']) {
  const source = await readFile(new URL(`../${path.replace('./', '')}`, import.meta.url), 'utf8');
  if (forbiddenCommands.some((command) => source.includes(command))) {
    throw new Error(`Dry-run implementation contains a forbidden release command: ${path}`);
  }
}
console.log(`Release dry run complete: ${manifest.packages.length} packages would be published; no publish, tag, or release action occurred.`);
