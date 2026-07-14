import type { RuntimeErrorCode } from './types.js';

export interface RuntimeErrorInput {
  message: string;
  code: RuntimeErrorCode;
  retryable: boolean;
  retryAfterMs?: number;
  adapterId?: string;
  details?: Readonly<Record<string, unknown>>;
  cause?: unknown;
}

const SENSITIVE_KEY_PATTERN =
  /(token|secret|password|credential|private.?key|authorization|cookie|prompt|message|attachment|body)/i;
const SENSITIVE_VALUE_PATTERNS = [
  /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(token|access_token|api_key|password|cookie|secret|authorization|device_token)=([^&\s]+)/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
];

export class RuntimeError extends Error {
  readonly code: RuntimeErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly adapterId?: string;
  readonly details?: Readonly<Record<string, unknown>>;
  override readonly cause?: unknown;

  constructor(input: RuntimeErrorInput) {
    super(input.message, { cause: input.cause });
    this.name = 'RuntimeError';
    this.code = input.code;
    this.retryable = input.retryable;
    this.retryAfterMs = input.retryAfterMs;
    this.adapterId = input.adapterId;
    this.details = input.details ? sanitizeDetails(input.details) : undefined;
    this.cause = input.cause;
  }
}

export function sanitizeDetails(
  details: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? '[redacted]' : sanitizeValue(value),
    ]),
  );
}

function sanitizeValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitizeValue);
  if (typeof value === 'object') return sanitizeDetails(value as Record<string, unknown>);
  return String(value);
}

function sanitizeString(value: string): string {
  const redacted = SENSITIVE_VALUE_PATTERNS.reduce((current, pattern) => current.replace(pattern, (match, key) => {
    if (typeof key === 'string' && key) return `${key}=[redacted]`;
    if (/^authorization\s*:/i.test(match)) return 'Authorization: Bearer [redacted]';
    return 'Bearer [redacted]';
  }), value);
  return redacted.length > 500 ? `${redacted.slice(0, 500)}...` : redacted;
}

export function isRuntimeError(error: unknown): error is RuntimeError {
  return error instanceof RuntimeError;
}

export function toRuntimeError(
  error: unknown,
  fallback: Omit<RuntimeErrorInput, 'cause'>,
): RuntimeError {
  if (isRuntimeError(error)) return error;
  return new RuntimeError({ ...fallback, cause: error });
}

export function unsupportedCapability(message: string, details?: Record<string, unknown>): RuntimeError {
  return new RuntimeError({
    code: 'UNSUPPORTED_CAPABILITY',
    retryable: false,
    message,
    details,
  });
}

export function invalidConfiguration(message: string, details?: Record<string, unknown>): RuntimeError {
  return new RuntimeError({
    code: 'INVALID_CONFIGURATION',
    retryable: false,
    message,
    details,
  });
}
