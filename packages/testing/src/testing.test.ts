import { describe, expect, it } from 'vitest';
import { TEXT_RUN_CAPABILITIES } from '@banzae/agent-runtime-core';
import { FakeRuntimeAdapter, createRuntimeAdapterConformanceSuite, smokeAdapterContract } from './index.js';

describe('testing package', () => {
  it('smoke-tests a fake adapter', async () => {
    await smokeAdapterContract({
      createAdapter: async () => new FakeRuntimeAdapter(),
      target: { endpoint: 'fake://runtime' },
      testInput: { text: 'hello' },
      supports: {},
      cleanup: async () => {},
    });
    expect(true).toBe(true);
  });

  it('runs conformance cases without coupling the API to a test runner', async () => {
    const suite = createRuntimeAdapterConformanceSuite({
      name: 'testing fake adapter',
      createTarget: () => ({ connection: { target: { endpoint: 'https://fake.example.test' }, auth: { kind: 'none' as const } } }),
      createAdapter: () => new FakeRuntimeAdapter(),
      expectedCapabilities: TEXT_RUN_CAPABILITIES,
      scenarios: {
        session: () => ({ applicationSessionId: 'application-session' }),
        run: (_target, session) => ({ applicationRunId: 'application-run', idempotencyKey: 'caller-key', session, input: { text: 'hello' } }),
      },
    });

    await suite.run();
    expect(suite.cases.some((testCase) => testCase.category === 'resources')).toBe(true);
  });
});
