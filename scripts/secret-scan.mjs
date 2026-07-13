#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const ignoredDirs = new Set(['node_modules', 'dist', '.runtime-state', '.git', 'coverage', 'sbom']);
const ignoredFiles = new Set(['pnpm-lock.yaml']);
const findings = [];
const patterns = [
  { name: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'authorization-header', re: /Authorization:\s*Bearer\s+[A-Za-z0-9._~+/-]{16,}/i },
  { name: 'long-hex-secret', re: /(?:token|password|secret|api[_-]?key)\s*[:=]\s*["']?[a-f0-9]{32,}["']?/i },
  { name: 'jwt', re: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/ },
];

for (const file of await listFiles(root)) {
  const rel = relative(root, file);
  if (ignoredFiles.has(rel)) continue;
  const text = await readFile(file, 'utf8').catch(() => undefined);
  if (text === undefined) continue;
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.includes('__REDACTED__') || line.includes('example.invalid') || line.includes('runtime.example.test')) return;
    for (const pattern of patterns) {
      if (pattern.re.test(line)) findings.push(`${rel}:${index + 1}: ${pattern.name}`);
    }
  });
}

if (findings.length > 0) {
  console.error(findings.join('\n'));
  process.exit(1);
}

console.log('Secret scan passed.');

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else files.push(path);
  }
  return files;
}
