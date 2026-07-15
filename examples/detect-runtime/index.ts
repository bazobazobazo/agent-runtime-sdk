import type { AgentRuntimeAdapter } from '@banzae/agent-runtime-core';
import { createTestDependencies } from '@banzae/agent-runtime-core/testing';
import { createRuntimeDetector, type RuntimeProbe } from '@banzae/agent-runtime-detection';
import { FakeRuntimeAdapter } from '@banzae/agent-runtime-testing';
import { EXAMPLE_ENDPOINT, runExample } from '../shared.js';

const fakeProbe: RuntimeProbe = {
  adapterId: 'fake',
  async probe() {
    return {
      adapterId: 'fake',
      matched: true,
      confidence: 1,
      runtimeProduct: 'fake-runtime',
      protocolName: 'fake',
      protocolVersion: '1',
      evidence: [{ kind: 'fake', message: 'deterministic example evidence' }],
      durationMs: 0,
    };
  },
};

export async function detectRuntimeExample(): Promise<string | undefined> {
  return runExample(async (signal) => {
    const adapter: AgentRuntimeAdapter = new FakeRuntimeAdapter();
    try {
      const detector = createRuntimeDetector({
        dependencies: createTestDependencies(),
        probes: [fakeProbe],
      });
      const result = await detector.detect({
        target: { endpoint: EXAMPLE_ENDPOINT },
        options: { allowManifest: false, signal },
      });
      return result.selected?.adapterId;
    } finally {
      await adapter.close();
    }
  });
}
