#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const commands = [
  ['pnpm', ['typecheck']],
  ['pnpm', ['test']],
  ['pnpm', ['test:fuzz']],
  ['pnpm', ['test:resilience']],
  ['pnpm', ['security:check']],
  ['pnpm', ['package:check']],
  ['pnpm', ['api:check']],
  ['pnpm', ['secret:scan']],
  ['pnpm', ['build']],
  ['pnpm', ['test:live:cli']],
  ['pnpm', ['consumer:check']],
  ['pnpm', ['examples:typecheck']],
  ['pnpm', ['examples:test']],
  ['pnpm', ['docs:check']],
  ['pnpm', ['unicode:check']],
  ['pnpm', ['artifact:scan']],
  ['pnpm', ['package:contents']],
  ['pnpm', ['run', 'sbom:generate']],
  ['pnpm', ['release:dry-run']],
];

for (const [cmd, args] of commands) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  await exec(cmd, args, { stdio: 'inherit', maxBuffer: 1024 * 1024 * 10 });
}

console.log('Release gate passed.');
