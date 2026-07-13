import type { RuntimeCrypto } from './ports.js';

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, sortValue(nested)]),
    );
  }
  return value;
}

export async function connectionFingerprint(
  crypto: RuntimeCrypto,
  input: Readonly<Record<string, unknown>>,
): Promise<string> {
  const digest = await crypto.sha256(canonicalJson(input));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function normalizeEndpoint(endpoint: string): string {
  const url = new URL(endpoint.replace(/^openclaw\+/, '').replace(/^hermes\+/, '').replace(/^agent\+/, ''));
  url.hash = '';
  url.username = '';
  url.password = '';
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
    url.port = '';
  }
  return url.toString();
}
