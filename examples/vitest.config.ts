import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const source = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: '@banzae/agent-runtime-core/testing', replacement: source('packages/core/src/testing.ts') },
      { find: '@banzae/agent-runtime-core/diagnostics', replacement: source('packages/core/src/diagnostics.ts') },
      { find: '@banzae/agent-runtime-core/experimental', replacement: source('packages/core/src/experimental.ts') },
      { find: '@banzae/agent-runtime-core', replacement: source('packages/core/src/index.ts') },
      { find: '@banzae/agent-runtime-detection', replacement: source('packages/detection/src/index.ts') },
      { find: '@banzae/agent-runtime-openclaw/experimental', replacement: source('packages/adapter-openclaw/src/experimental.ts') },
      { find: '@banzae/agent-runtime-openclaw', replacement: source('packages/adapter-openclaw/src/index.ts') },
      { find: '@banzae/agent-runtime-hermes/experimental', replacement: source('packages/adapter-hermes/src/experimental.ts') },
      { find: '@banzae/agent-runtime-hermes', replacement: source('packages/adapter-hermes/src/index.ts') },
      { find: '@banzae/agent-runtime-testing', replacement: source('packages/testing/src/index.ts') },
      { find: '@banzae/agent-runtime-node', replacement: source('packages/node/src/index.ts') },
    ],
  },
  test: {
    include: ['examples/**/*.test.ts'],
  },
});
