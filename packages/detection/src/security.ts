import { RuntimeError, normalizeEndpoint, type RuntimeAdapterDependencies, type RuntimeAuthInput, type RuntimeTarget } from '@banzae/agent-runtime-core';
import type { RuntimeNetworkPolicy } from './types.js';

export const DETECTION_SCHEMA_VERSION = 1;

const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:', 'openclaw+ws:', 'openclaw+wss:', 'hermes+http:', 'hermes+https:']);
const SECRET_KEY_RE = /(token|authorization|cookie|password|secret|credential|private.?key|device.?token|signature|api.?key)/i;

export class DefaultRuntimeNetworkPolicy implements RuntimeNetworkPolicy {
  async validateTarget(url: URL): Promise<void> {
    if (!ALLOWED_SCHEMES.has(url.protocol)) {
      throw policyError('Unsupported runtime endpoint scheme', { scheme: url.protocol });
    }
    if (url.username || url.password) {
      throw policyError('Runtime endpoint URLs must not embed credentials', { hostname: url.hostname });
    }
    if (!url.hostname) {
      throw policyError('Runtime endpoint host is required');
    }
  }

  async validateRedirect(from: URL, to: URL): Promise<void> {
    if (from.protocol === 'https:' && to.protocol === 'http:') {
      throw policyError('HTTPS to HTTP redirects are not allowed', { from: from.hostname, to: to.hostname });
    }
    if (from.hostname !== to.hostname) {
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
  const url = new URL(normalizeDetectionEndpoint(input.target.endpoint));
  const canonical = {
    schemaVersion: DETECTION_SCHEMA_VERSION,
    endpoint: normalizeEndpoint(`${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}${url.pathname}`),
    adapterId: input.adapterId ?? input.target.adapterHint ?? 'auto',
    credentialRef: input.credentialRef ?? '',
    transportHint: input.target.transportHint ?? '',
  };
  return hex(await deps.crypto.sha256(JSON.stringify(canonical)));
}

export function sanitizeDetectionValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}...` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map(sanitizeDetectionValue);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        SECRET_KEY_RE.test(key) ? '[redacted]' : sanitizeDetectionValue(nested),
      ]),
    );
  }
  return String(value);
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
