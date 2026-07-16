#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const { stdout } = await exec('git', [
  'ls-files',
  '--cached',
  '--others',
  '--exclude-standard',
  '-z',
], { encoding: 'buffer', maxBuffer: 10 * 1024 * 1024 });
const paths = stdout.toString('utf8').split('\0').filter(Boolean);
const decoder = new TextDecoder('utf-8', { fatal: true });
const prohibited = /[\u00ad\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\u206a-\u206f\ufeff\ufff9-\ufffb\u007f-\u009f]/u;
const failures = [];
let scanned = 0;

for (const path of paths) {
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if (error?.code === 'ENOENT') continue;
    throw error;
  }
  if (bytes.includes(0)) continue;
  let text;
  try {
    text = decoder.decode(bytes);
  } catch {
    failures.push(`${path}: invalid UTF-8`);
    continue;
  }
  scanned += 1;
  const match = prohibited.exec(text);
  if (match) {
    const codePoint = match[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
    const line = text.slice(0, match.index).split('\n').length;
    failures.push(`${path}:${line}: prohibited hidden/control character U+${codePoint}`);
  }
}

if (failures.length) {
  throw new Error(`Strict Unicode scan failed:\n${failures.map((item) => `- ${item}`).join('\n')}`);
}

console.log(`Strict Unicode scan passed for ${scanned} tracked/untracked text files.`);
