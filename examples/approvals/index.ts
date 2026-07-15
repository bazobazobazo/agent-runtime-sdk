import {
  type AgentRuntimeAdapter,
  type OperationOptions,
  type ResolveRuntimeApprovalInput,
  type RuntimeApprovalResolution,
} from '@banzae/agent-runtime-core';
import { TEXT_RUN_CAPABILITIES } from '@banzae/agent-runtime-core/testing';
import { FakeRuntimeAdapter } from '@banzae/agent-runtime-testing';
import { EXAMPLE_ENDPOINT, runExample } from '../shared.js';

class ApprovalFakeAdapter extends FakeRuntimeAdapter {
  constructor() {
    super({
      ...TEXT_RUN_CAPABILITIES,
      runs: { ...TEXT_RUN_CAPABILITIES.runs, approvals: true },
    });
  }

  async resolveApproval(
    input: ResolveRuntimeApprovalInput,
    _options?: OperationOptions,
  ): Promise<RuntimeApprovalResolution> {
    return { ...input, resolvedAt: '2026-01-01T00:00:00.000Z' };
  }
}

export async function approvalsExample(): Promise<string> {
  return runExample(async (signal) => {
    const adapter: AgentRuntimeAdapter = new ApprovalFakeAdapter();
    try {
      await adapter.connect({ target: { endpoint: EXAMPLE_ENDPOINT } }, { signal });
      const resolution = await adapter.resolveApproval!({
        applicationRunId: 'approval-run',
        externalRunId: 'provider-run',
        approvalId: 'approval-1',
        decision: { action: 'allow', scope: 'once' },
      }, { signal });
      return resolution.decision.action;
    } finally {
      await adapter.close();
    }
  });
}
