import type { RuntimeErrorCode } from './types.js';
import { SECURE_RUNTIME_LIMITS } from './security-limit-values.js';

/** Public alpha contract for runtime error input. */
export interface RuntimeErrorInput {
  message: string;
  code: RuntimeErrorCode;
  retryable: boolean;
  retryAfterMs?: number;
  adapterId?: string;
  operation?: string;
  stage?: string;
  protocolName?: string;
  protocolVersion?: string;
  httpStatus?: number;
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
  /\bBasic\s+[A-Za-z0-9+/=]{8,}/gi,
  /\b(?:gh[opusr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,})\b/g,
  /\b(token|access_token|api_key|password|cookie|secret|authorization|device_token)%3[Dd]([^&\s]+)/gi,
  /\b(?:https?|wss?):\/\/[^\s"',)]+/gi,
];

/** Public alpha contract for runtime error. */
export class RuntimeError extends Error {
  readonly code: RuntimeErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly adapterId?: string;
  readonly operation?: string;
  readonly stage?: string;
  readonly protocolName?: string;
  readonly protocolVersion?: string;
  readonly httpStatus?: number;
  readonly details?: Readonly<Record<string, unknown>>;
  override readonly cause?: unknown;

  constructor(input: RuntimeErrorInput) {
    const safeMessage = sanitizeString(input.message);
    const safeCause = input.cause instanceof RuntimeError ? input.cause : undefined;
    super(safeMessage, safeCause ? { cause: safeCause } : undefined);
    this.name = 'RuntimeError';
    this.code = input.code;
    this.retryable = input.retryable;
    this.retryAfterMs = input.retryAfterMs;
    this.adapterId = input.adapterId;
    this.operation = input.operation;
    this.stage = input.stage;
    this.protocolName = input.protocolName;
    this.protocolVersion = input.protocolVersion;
    this.httpStatus = input.httpStatus;
    this.details = input.details ? sanitizeDetails(input.details) : undefined;
    this.cause = safeCause;
  }
}

export function sanitizeDetails(
  details: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return boundDetails(sanitizeObject(details, 0, new WeakSet<object>()));
}

export function sanitizeProviderPayload(value: unknown): unknown {
  return sanitizeValue(value, 0, new WeakSet<object>());
}

function sanitizeValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value !== 'object') return sanitizeString(String(value));
  if (depth >= SECURE_RUNTIME_LIMITS.maxRawPayloadDepth) return '[max-depth]';
  if (seen.has(value)) return '[circular]';
  if (Array.isArray(value)) {
    seen.add(value);
    return value
      .slice(0, SECURE_RUNTIME_LIMITS.maxDiagnosticArrayItems)
      .map((item) => sanitizeValue(item, depth + 1, seen));
  }
  return sanitizeObject(value as Record<string, unknown>, depth + 1, seen);
}

function sanitizeObject(value: Readonly<Record<string, unknown>>, depth: number, seen: WeakSet<object>): Readonly<Record<string, unknown>> {
  if (seen.has(value)) return { value: '[circular]' };
  seen.add(value);
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, SECURE_RUNTIME_LIMITS.maxRawPayloadKeys)
      .map(([key, nested]) => [
        key.slice(0, 256),
        SENSITIVE_KEY_PATTERN.test(key) ? '[redacted]' : sanitizeValue(nested, depth, seen),
      ]),
  );
}

function sanitizeString(value: string): string {
  const redacted = SENSITIVE_VALUE_PATTERNS.reduce((current, pattern) => current.replace(pattern, (match, key) => {
    if (typeof key === 'string' && key) return `${key}=[redacted]`;
    if (/^authorization\s*:/i.test(match)) return 'Authorization: Bearer [redacted]';
    if (/^basic\s/i.test(match)) return 'Basic [redacted]';
    if (/^(?:https?|wss?):\/\//i.test(match)) return '[redacted-url]';
    return '[redacted]';
  }), value);
  return redacted.length > SECURE_RUNTIME_LIMITS.maxDiagnosticStringLength
    ? `${redacted.slice(0, SECURE_RUNTIME_LIMITS.maxDiagnosticStringLength)}...`
    : redacted;
}

function boundDetails(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const output: Record<string, unknown> = {};
  let bytes = 2;
  for (const [key, nested] of Object.entries(value)) {
    const entryBytes = new TextEncoder().encode(JSON.stringify([key, nested])).byteLength;
    if (bytes + entryBytes > SECURE_RUNTIME_LIMITS.maxErrorDetailBytes) {
      output.truncated = true;
      break;
    }
    output[key] = nested;
    bytes += entryBytes;
  }
  return output;
}

/** Public alpha contract for is runtime error. */
export function isRuntimeError(error: unknown): error is RuntimeError {
  return error instanceof RuntimeError;
}

/** Public alpha contract for has runtime error code. */
export function hasRuntimeErrorCode<C extends import('./types.js').RuntimeErrorCode>(
  error: unknown,
  code: C,
): error is RuntimeError & { readonly code: C } {
  return isRuntimeError(error) && error.code === code;
}

/** Public alpha contract for create runtime error. */
export function createRuntimeError(input: RuntimeErrorInput): RuntimeError {
  return new RuntimeError(input);
}

/** Public alpha contract for to runtime error. */
export function toRuntimeError(
  error: unknown,
  fallback: Omit<RuntimeErrorInput, 'cause'>,
): RuntimeError {
  if (isRuntimeError(error)) return error;
  return new RuntimeError({ ...fallback, cause: error });
}

/** Public alpha contract for unsupported capability. */
export function unsupportedCapability(message: string, details?: Record<string, unknown>): RuntimeError {
  return new RuntimeError({
    code: 'UNSUPPORTED_CAPABILITY',
    retryable: false,
    message,
    details,
  });
}

/** Public alpha contract for invalid configuration. */
export function invalidConfiguration(message: string, details?: Record<string, unknown>): RuntimeError {
  return new RuntimeError({
    code: 'INVALID_CONFIGURATION',
    retryable: false,
    message,
    details,
  });
}
