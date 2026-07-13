import { describe, expect, it } from 'vitest';
import {
  RuntimeError,
  RuntimeRegistry,
  assertStartRunInput,
  canonicalJson,
  createTestDependencies,
  sanitizeDetails,
  supportsCapability,
  TEXT_RUN_CAPABILITIES,
} from './index.js';

describe('core helpers', () => {
  it('redacts sensitive details', () => {
    expect(
      sanitizeDetails({
        token: 'secret',
        nested: { password: 'hidden', status: 'ok' },
      }),
    ).toEqual({ token: '[redacted]', nested: { password: '[redacted]', status: 'ok' } });
  });

  it('keeps canonical json stable across key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it('checks capabilities', () => {
    expect(supportsCapability(TEXT_RUN_CAPABILITIES, 'runs.start')).toBe(true);
    expect(supportsCapability(TEXT_RUN_CAPABILITIES, 'input.files')).toBe(false);
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
