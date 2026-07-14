import { RuntimeError, normalizeEndpoint, sanitizeProviderPayload, type RuntimeAdapterDependencies, type RuntimeAuthInput, type RuntimeTarget } from '@banzae/agent-runtime-core';
import type { RuntimeNetworkPolicy } from './types.js';

export const DETECTION_SCHEMA_VERSION = 1;

const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:', 'openclaw+ws:', 'openclaw+wss:', 'hermes+http:', 'hermes+https:']);
const SECRET_QUERY_KEYS = new Set(['token', 'access_token', 'api_key', 'password', 'secret', 'authorization', 'device_token']);
const SECRET_VALUE_PATTERNS = [
  /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(token|access_token|api_key|password|cookie|secret|authorization|device_token)=([^&\s]+)/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
];

export class DefaultRuntimeNetworkPolicy implements RuntimeNetworkPolicy {
  async validateTarget(url: URL): Promise<void> {
    if (!ALLOWED_SCHEMES.has(url.protocol)) {
      throw policyError('Unsupported runtime endpoint scheme', { scheme: url.protocol });
    }
    if (url.username || url.password) {
      throw policyError('Runtime endpoint URLs must not embed credentials', { hostname: url.hostname });
    }
    for (const key of url.searchParams.keys()) {
      if (SECRET_QUERY_KEYS.has(key.toLowerCase())) {
        throw policyError('Runtime endpoint URLs must not include credential query parameters', { hostname: url.hostname, parameter: key });
      }
    }
    if (!url.hostname) {
      throw policyError('Runtime endpoint host is required');
    }
    if (url.port) {
      const port = Number(url.port);
      if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
        throw policyError('Runtime endpoint port is invalid', { hostname: url.hostname });
      }
    }
  }

  async validateRedirect(from: URL, to: URL): Promise<void> {
    if (from.protocol === 'https:' && to.protocol === 'http:') {
      throw policyError('HTTPS to HTTP redirects are not allowed', { from: from.hostname, to: to.hostname });
    }
    if (from.host !== to.host) {
      throw policyError('Cross-host runtime redirects are not allowed', { from: from.hostname, to: to.hostname });
    }
  }
}

export function normalizeDetectionEndpoint(endpoint: string): string {
  return endpoint
    .replace(/^openclaw\+ws:/, 'ws:')
    .replace(/^openclaw\+wss:/, 'wss:')
    .replace(/^hermes\+http:/, 'http:')
    .replace(/^hermes\+https:/, 'https:');
}

export async function detectionFingerprint(
  deps: RuntimeAdapterDependencies,
  input: { target: RuntimeTarget; adapterId?: string | 'auto'; credentialRef?: string },
): Promise<string> {
  let url: URL;
  try {
    url = new URL(normalizeDetectionEndpoint(input.target.endpoint));
  } catch {
    throw policyError('Runtime endpoint URL is invalid');
  }
  const canonical = {
    schemaVersion: DETECTION_SCHEMA_VERSION,
    endpoint: normalizeEndpoint(`${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}${url.pathname}`),
    adapterId: input.adapterId ?? input.target.adapterHint ?? 'auto',
    transportHint: input.target.transportHint ?? '',
  };
  return hex(await deps.crypto.sha256(JSON.stringify(canonical)));
}

export function sanitizeDetectionValue(value: unknown): unknown {
  return sanitizeProviderPayload(value);
}

export function sanitizeString(value: string): string {
  const redacted = SECRET_VALUE_PATTERNS.reduce((current, pattern) => current.replace(pattern, (match, key) => {
    if (typeof key === 'string' && key) return `${key}=[redacted]`;
    if (/^authorization\s*:/i.test(match)) return 'Authorization: Bearer [redacted]';
    return 'Bearer [redacted]';
  }), value);
  return redacted.length > 500 ? `${redacted.slice(0, 500)}...` : redacted;
}

export function authHeaders(auth?: RuntimeAuthInput): Readonly<Record<string, string>> | undefined {
  if (!auth || auth.kind === 'none') return undefined;
  if (auth.kind === 'token' || auth.kind === 'bearer' || auth.kind === 'device-token') {
    return { Authorization: `Bearer ${auth.token}` };
  }
  return undefined;
}

function policyError(message: string, details?: Record<string, unknown>): RuntimeError {
  return new RuntimeError({ code: 'INVALID_CONFIGURATION', retryable: false, message, details, adapterId: 'detection' });
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
