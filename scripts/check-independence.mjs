#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = new URL('..', import.meta.url).pathname;
const productWord = ['for', 'ge'].join('');
const consumerWord = ['agent', 'hub'].join('');
const previousLibraryWord = ['tele', 'graphic'].join('');
const disallowed = [
  previousLibraryWord,
  ['@', previousLibraryWord, '-dev/openclaw-gateway-client'].join(''),
  consumerWord,
  ['agent', 'hub'].join(' '),
  ['banzae', productWord].join(''),
  ['banzae', productWord].join(' '),
  ...['integration', 'service', 'worker', 'owns', 'rollout', 'database', 'feature flag']
    .map((suffix) => `${productWord} ${suffix}`),
];
const findings = [];
const files = new Set();

try {
  const { stdout } = await exec('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'buffer',
    maxBuffer: 20 * 1024 * 1024,
  });
  for (const path of stdout.toString('utf8').split('\0').filter(Boolean)) files.add(resolve(root, path));
} catch (error) {
  if (!String(error?.stderr).includes('not a git repository')) throw error;
  const ignored = new Set(['.git', 'node_modules', 'dist', 'artifacts', '.release-pack', '.runtime-state', 'coverage']);
  for (const path of await filesUnder(root, ignored)) files.add(path);
}

for (const directory of [join(root, 'artifacts', 'release'), join(root, 'sbom')]) {
  if (existsSync(directory)) for (const path of await filesUnder(directory)) files.add(path);
}
const packageRoot = join(root, 'packages');
for (const entry of await readdir(packageRoot, { withFileTypes: true })) {
  const output = join(packageRoot, entry.name, 'dist');
  if (entry.isDirectory() && existsSync(output)) for (const path of await filesUnder(output)) files.add(path);
}
for (const input of process.argv.slice(2)) {
  const path = resolve(input);
  if (existsSync(path)) {
    const entries = await filesUnder(path);
    if (entries.length) for (const entry of entries) files.add(entry);
    else files.add(path);
  }
}

for (const path of [...files].sort()) {
  const bytes = await readFile(path).catch(() => undefined);
  if (!bytes) continue;
  check(relative(root, path), relative(root, path));
  if (bytes.includes(0)) continue;
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  check(relative(root, path), text);
}

const archives = [...files].filter((path) => extname(path) === '.tgz');
for (const archive of archives) {
  const listing = (await exec('tar', ['-tzf', archive], { maxBuffer: 20 * 1024 * 1024 })).stdout;
  check(relative(root, archive), listing);
  for (const entry of listing.split('\n').filter((name) => name && !name.endsWith('/'))) {
    const { stdout: content } = await exec('tar', ['-xOf', archive, entry], {
      encoding: 'buffer',
      maxBuffer: 20 * 1024 * 1024,
    });
    if (content.includes(0)) continue;
    const text = new TextDecoder('utf-8', { fatal: true }).decode(content);
    check(`${relative(root, archive)}:${entry}`, text);
  }
}

if (findings.length) {
  throw new Error(`Product-independence check failed:\n${findings.map((item) => `- ${item}`).join('\n')}`);
}

console.log(`Product-independence check passed for ${files.size} files and ${archives.length} package archives.`);

function check(label, value) {
  const lower = value.toLowerCase();
  for (const term of disallowed) {
    if (lower.includes(term)) findings.push(`${label}: disallowed product-specific term`);
  }
}

async function filesUnder(path, ignored = new Set()) {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  if (!entries.length) return existsSync(path) ? [path] : [];
  const output = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) output.push(...await filesUnder(child, ignored));
    else if (entry.isFile()) output.push(child);
  }
  return output;
}
