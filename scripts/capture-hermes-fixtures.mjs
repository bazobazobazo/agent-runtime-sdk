#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { sanitizeFixture } from './lib/sanitize-fixture.mjs';

const baseUrl = (process.env.HERMES_BASE_URL ?? '').replace(/\/$/, '');
const token = process.env.HERMES_BEARER_TOKEN;
const out = process.env.OUT ?? 'fixtures/hermes/live-capabilities.json';

if (!baseUrl) throw new Error('HERMES_BASE_URL is required');

async function request(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}`, Accept: 'application/json' } : { Accept: 'application/json' },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body,
  };
}

const capabilities = await request('/v1/capabilities');
let detailedHealth;
try {
  detailedHealth = await request('/health/detailed');
} catch (error) {
  detailedHealth = { error: error instanceof Error ? error.message : String(error) };
}

await mkdir(dirname(resolve(out)), { recursive: true });
await writeFile(
  out,
  `${JSON.stringify(
    sanitizeFixture({
      runtime: 'hermes',
      capturedAt: new Date().toISOString(),
      source: 'live capabilities capture',
      capabilities,
      detailedHealth,
    }),
    null,
    2,
  )}\n`,
  'utf8',
);

console.log(`wrote ${out}`);
