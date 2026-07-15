#!/usr/bin/env node
import { access, readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const repository = new URL('../', import.meta.url).pathname;
const packageEntries = await readdir(join(repository, 'packages'), { withFileTypes: true });
const roots = [
  ...packageEntries.filter((entry) => entry.isDirectory()).map((entry) => join('packages', entry.name, 'dist')),
  'sbom', 'docs', 'fixtures', 'artifacts/release',
];
const failures = [];
let scanned = 0;
const patterns = [
  [/\/home\/openclaw\//, 'host home path'],
  [/\/Users\/[A-Za-z0-9._-]+\//, 'host user path'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\bBearer\s+(?!\[redacted\]|\$\{|<|__REDACTED__)\S{16,}/i, 'bearer credential'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/, 'JWT'],
  [/\b(?:internal|private|corp)\.(?:[a-z0-9-]+\.)*[a-z]{2,63}\b/i, 'internal hostname'],
  [/[?&](?:token|access_token|api_key|password|secret|authorization|device_token)=[^&"\s]+/i, 'query credential'],
];

for (const name of roots) {
  const root = join(repository, name);
  if (!await exists(root)) continue;
  for (const file of await listFiles(root)) {
    if (!/\.(?:js|mjs|cjs|map|d\.ts|json|jsonl|md|txt)$/.test(file)) continue;
    const text = await readFile(file, 'utf8').catch(() => undefined);
    if (text === undefined) continue;
    scanned += 1;
    for (const [pattern, label] of patterns) if (pattern.test(text)) failures.push(`${relative(repository, file)}: ${label}`);
  }
}
if (failures.length) { process.stderr.write(`${failures.join('\n')}\n`); process.exit(1); }
process.stdout.write(`Scanned ${scanned} build, documentation, SBOM, and fixture artifacts.\n`);

async function exists(path) { return access(path).then(() => true, () => false); }
async function listFiles(dir) {
  const output = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'coverage'].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) output.push(...await listFiles(path));
    else output.push(path);
  }
  return output;
}
