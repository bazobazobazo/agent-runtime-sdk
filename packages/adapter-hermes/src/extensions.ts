import type { RuntimeApprovalDecision, RuntimeMessage } from '@banzae/agent-runtime-core';

/** Public alpha contract for runtime approval capability. */
export interface RuntimeApprovalCapability {
  resolveApproval(input: {
    externalRunId: string;
    approvalId: string;
    decision: RuntimeApprovalDecision;
    comment?: string;
  }): Promise<void>;
}

/** Public alpha contract for hermes sessions extension. */
export interface HermesSessionsExtension {
  list(input?: { limit?: number; offset?: number }): Promise<unknown>;
  create(input?: { title?: string }): Promise<{ id: string }>;
  get(id: string): Promise<unknown>;
  messages(id: string): Promise<RuntimeMessage[]>;
  fork(id: string, input?: { title?: string }): Promise<{ id: string }>;
  delete(id: string): Promise<void>;
}

export interface HermesJobsExtension {
  list(): Promise<unknown[]>;
  create(input: unknown): Promise<unknown>;
  update(id: string, patch: unknown): Promise<unknown>;
  remove(id: string): Promise<void>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  runNow(id: string): Promise<unknown>;
}
