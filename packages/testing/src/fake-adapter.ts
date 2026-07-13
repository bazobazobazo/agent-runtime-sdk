import {
  TEXT_RUN_CAPABILITIES,
  assertStartRunInput,
  runtimeEventBase,
  type AgentRuntimeAdapter,
  type RuntimeCapabilities,
  type RuntimeEvent,
} from '@banzae/agent-runtime-core';

export class FakeRuntimeAdapter implements AgentRuntimeAdapter {
  readonly adapterId = 'fake';
  readonly adapterVersion = '0.1.0';
  private closed = false;
  private readonly caps: RuntimeCapabilities;

  constructor(capabilities: RuntimeCapabilities = TEXT_RUN_CAPABILITIES) {
    this.caps = capabilities;
  }

  async probe() {
    return {
      matched: true,
      confidence: 1,
      adapterId: this.adapterId,
      runtimeProduct: 'fake-runtime',
      protocolName: 'fake',
      protocolVersion: '1',
      evidence: ['fake adapter'],
      warnings: [],
      durationMs: 0,
      capabilities: this.caps,
    };
  }

  async connect() {
    return {
      descriptor: {
        schemaVersion: 1 as const,
        adapterId: this.adapterId,
        adapterVersion: this.adapterVersion,
        runtimeProduct: 'fake-runtime',
        protocolName: 'fake',
        protocolVersion: '1',
        capabilities: this.caps,
      },
      connectedAt: new Date().toISOString(),
      warnings: [],
    };
  }

  async health() {
    return { status: 'healthy' as const, checkedAt: new Date().toISOString(), warnings: [] };
  }

  async capabilities() {
    return this.caps;
  }

  async ensureSession(input: { applicationSessionId: string }) {
    return { applicationSessionId: input.applicationSessionId, externalSessionId: input.applicationSessionId, created: true };
  }

  async startRun(input: { applicationRunId: string; idempotencyKey: string; session: { externalSessionId: string } }) {
    assertStartRunInput(input);
    return { applicationRunId: input.applicationRunId, externalRunId: `fake:${input.applicationRunId}`, status: 'running' as const };
  }

  async *streamRun(input: { applicationRunId: string; externalRunId: string; externalSessionId: string }): AsyncIterable<RuntimeEvent> {
    yield {
      ...runtimeEventBase({
        ids: { id: () => 'fake-1' },
        now: new Date(),
        type: 'assistant.completed',
        applicationRunId: input.applicationRunId,
        externalRunId: input.externalRunId,
        externalSessionId: input.externalSessionId,
      }),
      type: 'assistant.completed',
      text: 'ok',
    };
    yield {
      ...runtimeEventBase({
        ids: { id: () => 'fake-2' },
        now: new Date(),
        type: 'run.completed',
        applicationRunId: input.applicationRunId,
        externalRunId: input.externalRunId,
        externalSessionId: input.externalSessionId,
      }),
      type: 'run.completed',
    };
  }

  async getRun(input: { applicationRunId: string; externalRunId: string }) {
    return { applicationRunId: input.applicationRunId, externalRunId: input.externalRunId, status: 'completed' as const, output: 'ok' };
  }

  async cancelRun() {}

  async getHistory() {
    return [{ role: 'assistant' as const, content: 'ok' }];
  }

  async close() {
    this.closed = true;
  }

  isClosed(): boolean {
    return this.closed;
  }
}
