import { RuntimeError } from '@banzae/agent-runtime-core';
import { sanitizeProviderPayload } from '@banzae/agent-runtime-core/diagnostics';

export function asRecord(value: unknown, context = 'OpenClaw payload'): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  throw protocolError(`${context} must be an object`, { receivedType: typeof value });
}

export function optionalRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function validTimestamp(value?: string): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

export function protocolError(message: string, details?: Record<string, unknown>): RuntimeError {
  return new RuntimeError({
    code: 'INVALID_RESPONSE',
    retryable: false,
    adapterId: 'openclaw',
    message,
    details,
  });
}

export function protocolMismatch(message: string, details?: Record<string, unknown>): RuntimeError {
  return new RuntimeError({
    code: 'PROTOCOL_MISMATCH',
    retryable: false,
    adapterId: 'openclaw',
    message,
    details,
  });
}

const SENSITIVE_KEY =
  /^(authorization|token|accessToken|refreshToken|gatewayToken|deviceToken|password|secret|signature|cookie|privateKey|apiKey)$/i;
const SENSITIVE_SUBSTRING = /(authorization|token|password|secret|signature|cookie|private.?key|api.?key|credential)/i;
const HOST_RE = /\b([a-z0-9-]+\.)*banzae\.dev\b/gi;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const HOME_PATH_RE = /\/home\/[^\s"',)]+/g;

export const OPENCLAW_SANITIZER_VERSION = 'openclaw-sanitizer-v2';

export function sanitizeOpenClawPayload(value: unknown): unknown {
  return sanitizeEnvironment(sanitizeProviderPayload(value));
}

function sanitizeEnvironment(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === 'string') {
    return value.replace(HOST_RE, 'runtime.example.test').replace(IPV4_RE, '192.0.2.1').replace(HOME_PATH_RE, '/home/runtime');
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(sanitizeEnvironment);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        SENSITIVE_KEY.test(key) || SENSITIVE_SUBSTRING.test(key) ? '[redacted]' : sanitizeEnvironment(nested),
      ]),
    );
  }
  return String(value);
}
