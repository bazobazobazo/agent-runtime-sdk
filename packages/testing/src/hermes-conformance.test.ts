import { describe, it } from 'vitest';
import { createHermesConformanceSuite } from './test-support/conformance.js';

const suite = createHermesConformanceSuite();

describe(`shared conformance: ${suite.name}`, () => {
  for (const testCase of suite.cases) it(`[${testCase.category}] ${testCase.name}`, testCase.run);
});
