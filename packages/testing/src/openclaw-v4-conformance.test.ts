import { describe, it } from 'vitest';
import { createOpenClawV4ConformanceSuite } from './test-support/conformance.js';

const suite = createOpenClawV4ConformanceSuite();

describe(`shared conformance: ${suite.name}`, () => {
  for (const testCase of suite.cases) it(`[${testCase.category}] ${testCase.name}`, testCase.run);
});
