import {
  NO_CAPABILITIES,
  RuntimeError,
  type AgentRuntimeAdapter,
  type RuntimeCapabilities,
  type RuntimeAdapterLifecycleState,
  type RuntimeEvent,
  type StartRuntimeRunInput,
} from '@banzae/agent-runtime-core';
import { TEXT_RUN_CAPABILITIES } from '@banzae/agent-runtime-core/testing';
import {
  assertStartRunInput,
  runtimeEventBase,
  validateInputCapabilities,
} from '@banzae/agent-runtime-core/experimental';

export class FakeRuntimeAdapter implements AgentRuntimeAdapter {
  readonly adapterId = 'fake';
  readonly adapterVersion = '0.1.0';
  private state: RuntimeAdapterLifecycleState = 'created';
  get lifecycleState(): RuntimeAdapterLifecycleState { return this.state; }
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
    this.state = 'connected';
    this.closed = false;
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
    return {
      status: this.state === 'connected' ? 'healthy' as const : 'unavailable' as const,
      checkedAt: new Date().toISOString(),
      warnings: this.state === 'connected' ? [] : ['not connected'],
    };
  }

  async capabilities() {
    return this.state === 'connected' ? this.caps : NO_CAPABILITIES;
  }

  async ensureSession(input: { applicationSessionId: string }) {
    this.assertConnected();
    return { applicationSessionId: input.applicationSessionId, externalSessionId: input.applicationSessionId, created: true };
  }

  async startRun(input: StartRuntimeRunInput) {
    this.assertConnected();
    assertStartRunInput(input);
    validateInputCapabilities(this.caps, input.input);
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
    this.assertConnected();
    return { applicationRunId: input.applicationRunId, externalRunId: input.externalRunId, status: 'completed' as const, output: 'ok' };
  }

  async cancelRun() {}

  async getHistory() {
    return { messages: [{ role: 'assistant' as const, content: 'ok' }] };
  }

  async close() {
    this.state = 'closing';
    this.closed = true;
    this.state = 'closed';
  }

  isClosed(): boolean {
    return this.closed;
  }

  private assertConnected(): void {
    if (this.state !== 'connected') {
      throw new RuntimeError({
        code: 'INVALID_CONFIGURATION',
        retryable: false,
        message: 'Fake adapter is not connected',
      });
    }
  }
}
