#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';

const directory = new URL('../.github/workflows/', import.meta.url);
const files = (await readdir(directory)).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'));
const failures = [];
for (const file of files) {
  const text = await readFile(new URL(file, directory), 'utf8');
  if (/packages:\s*write/i.test(text)) failures.push(`${file}: packages write permission is forbidden`);
  if (file !== 'release.yml' && /id-token:\s*write|npm\s+publish|pnpm\s+publish|gh\s+release\s+create/i.test(text)) failures.push(`${file}: publishing capability is forbidden`);
  if (/NODE_AUTH_TOKEN|NPM_TOKEN/.test(text)) failures.push(`${file}: long-lived npm token usage is forbidden`);
  if (!/^permissions:\s*\n/m.test(text)) failures.push(`${file}: explicit permissions are required`);
  if (!/timeout-minutes:/m.test(text)) failures.push(`${file}: job timeout is required`);
  for (const match of text.matchAll(/uses:\s*([^\s#]+)/g)) {
    if (!/@[a-f0-9]{40}$/.test(match[1])) failures.push(`${file}: third-party action is not pinned to an immutable commit`);
  }
}
const dependency = await readFile(new URL('dependency-review.yml', directory), 'utf8').catch(() => '');
if (!/pull_request:/m.test(dependency) || /push:/m.test(dependency) || !/dependency-graph\/sbom/.test(dependency) || !/dependency:audit/.test(dependency)) failures.push('dependency-review.yml: safe PR-only review/fallback is missing');
const codeql = await readFile(new URL('codeql.yml', directory), 'utf8').catch(() => '');
if (!/security-events:\s*write/m.test(codeql) || !/languages:\s*\[\s*['"]?javascript-typescript/m.test(codeql) || !/push:\s*\n\s*branches:\s*\n\s*- main/m.test(codeql) || !/github\/codeql-action\/(?:init|analyze)@99df26d4f13ea111d4ec1a7dddef6063f76b97e9/.test(codeql)) failures.push('codeql.yml: current CodeQL PR/main/schedule configuration is missing');
const release = await readFile(new URL('release.yml', directory), 'utf8').catch(() => '');
for (const requirement of ['workflow_dispatch:', 'confirm_publish:', 'default: false', 'environment: npm-release', 'id-token: write', 'refs/tags/v', '--provenance']) {
  if (!release.includes(requirement)) failures.push(`release.yml: missing ${requirement}`);
}
if (/\npush:|\npull_request:/.test(release)) failures.push('release.yml: publication workflow must be manual only');
if ((release.match(/id-token:\s*write/g) ?? []).length !== 1) failures.push('release.yml: OIDC write must exist only in one publish job');
if (failures.length) { process.stderr.write(`${failures.join('\n')}\n`); process.exit(1); }
console.log(`Validated ${files.length} workflow files, current action pins, CodeQL triggers, and manual release security.`);
