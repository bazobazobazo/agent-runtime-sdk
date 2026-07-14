import { describe, it } from 'vitest';
import { createOpenClawV3ConformanceSuite } from './test-support/conformance.js';

const suite = createOpenClawV3ConformanceSuite();

describe(`shared conformance: ${suite.name}`, () => {
  for (const testCase of suite.cases) it(`[${testCase.category}] ${testCase.name}`, testCase.run);
});
