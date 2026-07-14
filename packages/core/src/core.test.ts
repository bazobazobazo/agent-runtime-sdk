import { describe, expect, it } from 'vitest';
import {
  RuntimeError,
  RuntimeRegistry,
  hasRuntimeErrorCode,
  isActiveRuntimeRunStatus,
  isTerminalRuntimeRunStatus,
  normalizeRuntimeTimestamp,
  supportsCapability,
} from './index.js';
import { assertStartRunInput, canonicalJson } from './experimental.js';
import { sanitizeDetails } from './diagnostics.js';
import { createTestDependencies, TEXT_RUN_CAPABILITIES } from './testing.js';

describe('core helpers', () => {
  it('redacts sensitive details', () => {
    expect(
      sanitizeDetails({
        token: 'secret',
        nested: { password: 'hidden', status: 'ok', url: 'https://example.test?access_token=secret' },
        headers: ['Authorization: Bearer header-secret'],
      }),
    ).toEqual({ token: '[redacted]', nested: { password: '[redacted]', status: 'ok', url: '[redacted-url]' }, headers: ['Authorization: Bearer [redacted]'] });
  });

  it('sanitizes public error messages and discards unsafe causes', () => {
    const error = new RuntimeError({
      code: 'PROVIDER_ERROR', retryable: false,
      message: `provider failed Authorization: ${'Bearer'} marker-secret-token`,
      cause: new Error('password=marker-secret-password'),
    });
    expect(error.message).not.toContain('marker-secret-token');
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain('marker-secret-password');
  });

  it('bounds serialized public error details', () => {
    const details = Object.fromEntries(Array.from({ length: 1_000 }, (_, index) => [`field-${index}`, 'x'.repeat(4_000)]));
    const error = new RuntimeError({ code: 'PROVIDER_ERROR', retryable: false, message: 'bounded', details });
    expect(new TextEncoder().encode(JSON.stringify(error.details)).byteLength).toBeLessThanOrEqual(64_000);
    expect(error.details?.truncated).toBe(true);
  });

  it('keeps canonical json stable across key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it('checks capabilities', () => {
    expect(supportsCapability(TEXT_RUN_CAPABILITIES, 'runs.start')).toBe(true);
    expect(supportsCapability(TEXT_RUN_CAPABILITIES, 'input.files')).toBe(false);
    expect(supportsCapability(TEXT_RUN_CAPABILITIES, 'runs.stream')).toBe(true);
  });

  it('normalizes timestamps and run status classification', () => {
    expect(normalizeRuntimeTimestamp('2026-07-14T12:00:00+02:00')).toBe('2026-07-14T10:00:00.000Z');
    expect(normalizeRuntimeTimestamp('not-a-date')).toBeUndefined();
    expect(isTerminalRuntimeRunStatus('completed')).toBe(true);
    expect(isTerminalRuntimeRunStatus('unknown')).toBe(false);
    expect(isActiveRuntimeRunStatus('waiting_for_approval')).toBe(true);
  });

  it('narrows normalized errors by code', () => {
    const error: unknown = new RuntimeError({ code: 'OUTCOME_UNKNOWN', retryable: true, message: 'uncertain' });
    expect(hasRuntimeErrorCode(error, 'OUTCOME_UNKNOWN')).toBe(true);
  });

  it('requires caller-owned idempotency keys', () => {
    expect(() => assertStartRunInput({ applicationRunId: 'run-1', idempotencyKey: '' })).toThrow(RuntimeError);
  });

  it('rejects duplicate registry ids', () => {
    const registry = new RuntimeRegistry(createTestDependencies());
    const factory = {
      adapterId: 'fake',
      create: () => {
        throw new Error('unused');
      },
    };
    registry.register(factory);
    expect(() => registry.register(factory)).toThrow(RuntimeError);
  });
});
