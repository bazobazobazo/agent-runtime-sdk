#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { root } from './lib/release-config.mjs';

const exec = promisify(execFile);
const status = async () => (await exec('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root })).stdout;
const before = await status();
const commands = [
  ['pnpm', ['install', '--frozen-lockfile', '--offline']],
  ['pnpm', ['lint']],
  ['pnpm', ['typecheck']],
  ['pnpm', ['test']],
  ['pnpm', ['test:live:cli']],
  ['pnpm', ['test:fuzz']],
  ['pnpm', ['test:resilience']],
  ['pnpm', ['clean']],
  ['pnpm', ['build']],
  ['pnpm', ['api:extract']],
  ['pnpm', ['api:check']],
  ['pnpm', ['docs:check']],
  ['pnpm', ['examples:typecheck']],
  ['pnpm', ['examples:test']],
  ['pnpm', ['package:check']],
  ['pnpm', ['package:contents']],
  ['pnpm', ['consumer:check']],
  ['pnpm', ['secret:scan']],
  ['pnpm', ['unicode:check']],
  ['pnpm', ['security:check']],
  ['pnpm', ['dependency:check']],
  ['pnpm', ['dependency:audit']],
  ['pnpm', ['license:check']],
  ['pnpm', ['release:plan']],
  ['pnpm', ['release:dry-run']],
  ['pnpm', ['release:test']],
  ['pnpm', ['build:reproducibility-check']],
  ['pnpm', ['artifact:scan']],
];

for (const [command, args] of commands) {
  console.log(`$ ${command} ${args.join(' ')}`);
  const result = await exec(command, args, { cwd: root, maxBuffer: 60 * 1024 * 1024 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}
const after = await status();
if (after !== before) throw new Error('Release gate modified the tracked/untracked working tree.');
console.log('Release gate passed without publishing or modifying repository state.');
