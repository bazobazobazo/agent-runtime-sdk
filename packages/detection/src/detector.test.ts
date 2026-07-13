import { describe, expect, it } from 'vitest';
import {
  RuntimeRegistry,
  createTestDependencies,
  type AgentRuntimeAdapter,
  type RuntimeProbeResult,
} from '@banzae/agent-runtime-core';
import { detectRuntime, explicitAdapterId, selectUnambiguousResult } from './index.js';

function fakeAdapter(adapterId: string, result: RuntimeProbeResult): AgentRuntimeAdapter {
  return {
    adapterId,
    adapterVersion: '0.0.0',
    probe: async () => ({ ...result, adapterId }),
    connect: async () => {
      throw new Error('not used');
    },
    health: async () => {
      throw new Error('not used');
    },
    capabilities: async () => {
      throw new Error('not used');
    },
    ensureSession: async () => {
      throw new Error('not used');
    },
    startRun: async () => {
      throw new Error('not used');
    },
    streamRun: async function* () {
      return;
    },
    getRun: async () => {
      throw new Error('not used');
    },
    cancelRun: async () => {},
    getHistory: async () => [],
    close: async () => {},
  };
}

describe('runtime detection', () => {
  it('detects adapter hints from schemes', () => {
    expect(explicitAdapterId({ endpoint: 'openclaw+wss://example.test' })).toBe('openclaw');
    expect(explicitAdapterId({ endpoint: 'hermes+https://example.test' })).toBe('hermes');
  });

  it('selects clear winner', () => {
    const result = selectUnambiguousResult([
      { matched: true, confidence: 0.96, adapterId: 'hermes', evidence: [], warnings: [], durationMs: 5 },
      { matched: true, confidence: 0.5, adapterId: 'openclaw', evidence: [], warnings: [], durationMs: 5 },
    ]);
    expect(result.adapterId).toBe('hermes');
  });

  it('fails ambiguous results', () => {
    expect(() =>
      selectUnambiguousResult([
        { matched: true, confidence: 0.91, adapterId: 'a', evidence: [], warnings: [], durationMs: 5 },
        { matched: true, confidence: 0.86, adapterId: 'b', evidence: [], warnings: [], durationMs: 5 },
      ]),
    ).toThrow(/ambiguous/i);
  });

  it('runs probes through registry', async () => {
    const registry = new RuntimeRegistry(createTestDependencies());
    registry.register({
      adapterId: 'hermes',
      create: () =>
        fakeAdapter('hermes', {
          matched: true,
          confidence: 1,
          evidence: ['capabilities'],
          warnings: [],
          durationMs: 1,
        }),
    });
    const result = await detectRuntime({ endpoint: 'https://hermes.test' }, { registry });
    expect(result.adapterId).toBe('hermes');
  });
});
