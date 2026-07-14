#!/usr/bin/env node
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? new URL('../fixtures/', import.meta.url).pathname);
const failures = [];
let count = 0;

for (const file of await listFiles(root)) {
  if (!/\.(?:json|jsonl)$/.test(file)) continue;
  count += 1;
  const info = await stat(file);
  if (info.size > 2_000_000) failures.push(`${relative(root, file)}: exceeds fixture size limit`);
  const text = await readFile(file, 'utf8');
  const records = file.endsWith('.jsonl') ? text.split(/\r?\n/).filter(Boolean) : [text];
  const parsedRecords = [];
  for (const [index, record] of records.entries()) {
    let parsed;
    try { parsed = JSON.parse(record); } catch { failures.push(`${relative(root, file)}:${index + 1}: malformed JSON`); continue; }
    parsedRecords.push(parsed);
    if (!file.endsWith('.jsonl')) validateMetadata(parsed, `${relative(root, file)}:${index + 1}`);
    validateContent(parsed, `${relative(root, file)}:${index + 1}`);
  }
  if (file.endsWith('.jsonl')) {
    const metadataRecord = parsedRecords.find((value) => isRecord(value?.metadata) || isRecord(value?.fixtureMetadata));
    validateMetadata(metadataRecord, `${relative(root, file)}:metadata`);
  }
}

if (failures.length) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`Validated ${count} committed fixture files.\n`);

function validateMetadata(value, label) {
  const metadata = isRecord(value?.metadata) ? value.metadata : isRecord(value?.fixtureMetadata) ? value.fixtureMetadata : value;
  const source = metadata?.source;
  const schema = metadata?.fixtureSchemaVersion;
  if (typeof source !== 'string' || !source) failures.push(`${label}: source classification is missing`);
  else if (!['synthetic', 'upstream-reference', 'sanitized-live-capabilities-only', 'sanitized-live-capture'].includes(source)) failures.push(`${label}: source classification is unsupported`);
  if (!Number.isInteger(schema) || schema < 1) failures.push(`${label}: fixture schema version is missing`);
  if (typeof metadata?.sanitizerVersion !== 'string' || !metadata.sanitizerVersion) failures.push(`${label}: sanitizer version is missing`);
  if (source === 'synthetic' && metadata.validatedRuntimeVersion != null) failures.push(`${label}: synthetic fixture claims a validated runtime version`);
  if (source === 'sanitized-live-candidate' || metadata.manualReviewRequired === true) failures.push(`${label}: unreviewed live candidate is committed`);
}

function validateContent(value, label) {
  const serialized = JSON.stringify(value);
  const patterns = [
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
    [/\bBearer\s+(?!\[redacted\])\S{12,}/i, 'bearer credential'],
    [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/, 'JWT'],
    [/(?:\/home\/openclaw|\/Users\/[^/"']+)/, 'private home path'],
    [/\b(?:internal|private|corp)\.(?:[a-z0-9-]+\.)*[a-z]{2,63}\b/i, 'internal hostname'],
    [/[?&](?:token|access_token|api_key|password|secret|authorization|device_token)=[^&"\s]+/i, 'query credential'],
  ];
  for (const [pattern, name] of patterns) if (pattern.test(serialized)) failures.push(`${label}: contains ${name}`);
}

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
async function listFiles(dir) {
  const output = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) output.push(...await listFiles(path));
    else output.push(path);
  }
  return output;
}
