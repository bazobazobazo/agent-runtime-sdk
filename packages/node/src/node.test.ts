import { describe, expect, it } from 'vitest';
import { createDefaultRuntimeRegistry, NodeMemorySecretStore } from './index.js';
import { MemoryStateStore } from '@banzae/agent-runtime-core';

describe('node facade', () => {
  it('registers OpenClaw and Hermes only', () => {
    const registry = createDefaultRuntimeRegistry({
      stateStore: new MemoryStateStore(),
      secretStore: new NodeMemorySecretStore(),
    });
    expect(registry.list().map((factory) => factory.adapterId).sort()).toEqual(['hermes', 'openclaw']);
  });
});
