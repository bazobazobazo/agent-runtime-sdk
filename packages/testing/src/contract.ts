import {
  RuntimeError,
  assertStartRunInput,
  type AgentRuntimeAdapter,
  type RuntimeCapabilities,
  type RuntimeTarget,
  type RuntimeUserInput,
} from '@banzae/agent-runtime-core';

export type AdapterTestHarness = {
  createAdapter(): Promise<AgentRuntimeAdapter>;
  target: RuntimeTarget;
  testInput: RuntimeUserInput;
  supports: Partial<RuntimeCapabilities>;
  cleanup(): Promise<void>;
};

export async function smokeAdapterContract(harness: AdapterTestHarness): Promise<void> {
  const adapter = await harness.createAdapter();
  try {
    const probe = await adapter.probe(harness.target);
    if (probe.matched && !probe.adapterId) {
      throw new Error('matched probe must include adapterId');
    }
    const capabilities = await adapter.capabilities();
    if (capabilities.schemaVersion !== 1) {
      throw new Error('capability schemaVersion must be 1');
    }
    try {
      assertStartRunInput({ applicationRunId: 'contract-run', idempotencyKey: '' });
      throw new Error('empty idempotency key was accepted');
    } catch (error) {
      if (!(error instanceof RuntimeError)) throw error;
    }
    await adapter.close();
  } finally {
    await harness.cleanup();
  }
}

export function defineAdapterContract(_harness: AdapterTestHarness): void {
  throw new Error(
    'Use smokeAdapterContract for programmatic tests or wrap it in your test runner. Full conformance suites should be adapter-specific.',
  );
}
