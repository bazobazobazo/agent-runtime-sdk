#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';

const directory = new URL('../.github/workflows/', import.meta.url);
const files = (await readdir(directory)).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'));
const failures = [];
for (const file of files) {
  const text = await readFile(new URL(file, directory), 'utf8');
  if (/packages:\s*write|id-token:\s*write/i.test(text)) failures.push(`${file}: publishing permission is forbidden`);
  if (/npm\s+publish|pnpm\s+publish|gh\s+release\s+create/i.test(text)) failures.push(`${file}: publishing command is forbidden`);
  if (!/^permissions:\s*\n/m.test(text)) failures.push(`${file}: explicit permissions are required`);
  if (!/timeout-minutes:/m.test(text)) failures.push(`${file}: job timeout is required`);
  for (const match of text.matchAll(/uses:\s*([^\s#]+)/g)) {
    if (!/@[a-f0-9]{40}$/.test(match[1])) failures.push(`${file}: third-party action is not pinned to an immutable commit`);
  }
}
const dependency = await readFile(new URL('dependency-review.yml', directory), 'utf8').catch(() => '');
if (!/pull_request:/m.test(dependency) || /push:/m.test(dependency)) failures.push('dependency-review.yml: must run only for pull requests');
const codeql = await readFile(new URL('codeql.yml', directory), 'utf8').catch(() => '');
if (!/security-events:\s*write/m.test(codeql) || !/languages:\s*\[\s*['"]?javascript-typescript/m.test(codeql)) failures.push('codeql.yml: minimal CodeQL configuration is missing');
if (failures.length) { process.stderr.write(`${failures.join('\n')}\n`); process.exit(1); }
process.stdout.write(`Validated ${files.length} workflow files for permissions and publication safety.\n`);
