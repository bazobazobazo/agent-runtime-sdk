import { describe, expect, it } from 'vitest';
import { FakeRuntimeAdapter, smokeAdapterContract } from './index.js';

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
});
