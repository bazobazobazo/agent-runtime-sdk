import {
  RuntimeError,
  assertStartRunInput,
  isTerminalEvent,
  type AgentRuntimeAdapter,
  type CancelRuntimeRunInput,
  type EnsureSessionInput,
  type GetRuntimeHistoryInput,
  type GetRuntimeRunInput,
  type RuntimeCapabilities,
  type RuntimeConnectionConfig,
  type RuntimeEvent,
  type RuntimeRunHandle,
  type RuntimeSession,
  type RuntimeTarget,
  type RuntimeUserInput,
  type StartRuntimeRunInput,
  type StreamRuntimeRunInput,
} from '@banzae/agent-runtime-core';

export type RuntimeConformanceCategory =
  | 'connection'
  | 'capabilities'
  | 'sessions'
  | 'runs'
  | 'streaming'
  | 'status'
  | 'cancellation'
  | 'history'
  | 'security'
  | 'resources';

export type RuntimeConformanceCase = {
  name: string;
  category: RuntimeConformanceCategory;
  run(): Promise<void>;
};

export type RuntimeConformanceResourceSnapshot = {
  openConnections?: number;
  pendingRequests?: number;
  activeRuns?: number;
  activeSubscriptions?: number;
  activeResponseBodies?: number;
  listeners?: number;
  timers?: number;
};

export type RuntimeConformanceTarget = {
  connection: RuntimeConnectionConfig;
  resourceSnapshot?(): RuntimeConformanceResourceSnapshot;
  providerActivityCount?(): number;
  receivedIdempotencyKeys?(): readonly string[];
  triggerStream?(run: RuntimeRunHandle, session: RuntimeSession): void | Promise<void>;
  triggerApproval?(run: RuntimeRunHandle, session: RuntimeSession): void | Promise<void>;
  confirmCancellation?(input: CancelRuntimeRunInput): void | Promise<void>;
};

export type RuntimeAdapterConformanceScenarios<TTarget extends RuntimeConformanceTarget> = {
  session(target: TTarget): EnsureSessionInput;
  run(target: TTarget, session: RuntimeSession): StartRuntimeRunInput;
  stream?(target: TTarget, run: RuntimeRunHandle, session: RuntimeSession): StreamRuntimeRunInput;
  status?(target: TTarget, run: RuntimeRunHandle, session: RuntimeSession): GetRuntimeRunInput;
  cancel?(target: TTarget, run: RuntimeRunHandle, session: RuntimeSession): CancelRuntimeRunInput;
  history?(target: TTarget, session: RuntimeSession): GetRuntimeHistoryInput;
  connectionFailures?: readonly {
    name: string;
    expectedCode: RuntimeError['code'];
    prepare(target: TTarget): void | Promise<void>;
  }[];
};

export type RuntimeAdapterConformanceConfig<TTarget extends RuntimeConformanceTarget> = {
  name: string;
  createTarget(): TTarget | Promise<TTarget>;
  createAdapter(target: TTarget): AgentRuntimeAdapter | Promise<AgentRuntimeAdapter>;
  expectedCapabilities: RuntimeCapabilities | ((target: TTarget) => RuntimeCapabilities);
  scenarios: RuntimeAdapterConformanceScenarios<TTarget>;
  lifecycle?: {
    beforeCase?(target: TTarget, caseName: string): void | Promise<void>;
    cleanup?(adapter: AgentRuntimeAdapter, target: TTarget): void | Promise<void>;
  };
};

export type RuntimeAdapterConformanceSuite = {
  name: string;
  cases: readonly RuntimeConformanceCase[];
  run(): Promise<void>;
};

/**
 * Builds provider-neutral conformance cases without depending on a particular
 * test runner. Test runners should register each returned case independently.
 */
export function createRuntimeAdapterConformanceSuite<TTarget extends RuntimeConformanceTarget>(
  config: RuntimeAdapterConformanceConfig<TTarget>,
): RuntimeAdapterConformanceSuite {
  const testCase = (
    category: RuntimeConformanceCategory,
    name: string,
    body: (adapter: AgentRuntimeAdapter, target: TTarget) => Promise<void>,
  ): RuntimeConformanceCase => ({
    category,
    name,
    run: () => withHarness(config, name, body),
  });

  const cases: RuntimeConformanceCase[] = [
    testCase('connection', 'connects with a valid provider-neutral descriptor', async (adapter, target) => {
      const info = await adapter.connect(target.connection);
      const descriptor = info.descriptor;
      assertEqual(descriptor.schemaVersion, 1, 'descriptor schemaVersion');
      assertEqual(descriptor.adapterId, adapter.adapterId, 'descriptor adapterId');
      assertEqual(descriptor.adapterVersion, adapter.adapterVersion, 'descriptor adapterVersion');
      assert(typeof descriptor.runtimeProduct === 'string' && descriptor.runtimeProduct.length > 0, 'runtime product is required');
      assert(typeof descriptor.protocolName === 'string' && descriptor.protocolName.length > 0, 'protocol name is required');
      assert(!containsSecretKey(descriptor), 'descriptor contains credential-like keys');
    }),
    testCase('connection', 'close is idempotent', async (adapter, target) => {
      await adapter.connect(target.connection);
      await adapter.close();
      await adapter.close();
      assertResourcesReleased(target.resourceSnapshot?.());
    }),
    testCase('capabilities', 'advertises the expected capabilities', async (adapter, target) => {
      const info = await adapter.connect(target.connection);
      const expected = typeof config.expectedCapabilities === 'function' ? config.expectedCapabilities(target) : config.expectedCapabilities;
      assertDeepEqual(info.descriptor.capabilities, expected, 'descriptor capabilities');
      assertDeepEqual(await adapter.capabilities(), expected, 'capabilities()');
    }),
    testCase('sessions', 'ensureSession is idempotent and keeps ID domains separate', async (adapter, target) => {
      await adapter.connect(target.connection);
      const input = config.scenarios.session(target);
      const first = await adapter.ensureSession(input);
      const second = await adapter.ensureSession({ ...input, providerState: first.providerState });
      assertEqual(first.applicationSessionId, input.applicationSessionId, 'application session id');
      assertEqual(second.applicationSessionId, input.applicationSessionId, 'application session id on reuse');
      assertEqual(second.externalSessionId, first.externalSessionId, 'external session id on reuse');
    }),
    testCase('runs', 'starts a text run without confusing application and external IDs', async (adapter, target) => {
      await adapter.connect(target.connection);
      const session = await adapter.ensureSession(config.scenarios.session(target));
      const input = config.scenarios.run(target, session);
      const handle = await adapter.startRun(input);
      assertEqual(handle.applicationRunId, input.applicationRunId, 'application run id');
      assert(typeof handle.externalRunId === 'string' && handle.externalRunId.length > 0, 'external run id is required');
      const receivedIdempotencyKeys = target.receivedIdempotencyKeys?.();
      if (receivedIdempotencyKeys) assertEqual(receivedIdempotencyKeys.at(-1), input.idempotencyKey, 'caller idempotency key');
    }),
    testCase('runs', 'rejects unsupported attachments before provider activity', async (adapter, target) => {
      await adapter.connect(target.connection);
      const capabilities = await adapter.capabilities();
      if (capabilities.input.images && capabilities.input.files) return;
      const session = await adapter.ensureSession(config.scenarios.session(target));
      const baseline = target.providerActivityCount?.();
      const original = config.scenarios.run(target, session);
      const attachment = capabilities.input.images
        ? { kind: 'file' as const, mimeType: 'text/plain', name: 'unsupported.txt', data: new Uint8Array([1]) }
        : { kind: 'image' as const, mimeType: 'image/png', name: 'unsupported.png', data: new Uint8Array([1]) };
      await assertRuntimeError(
        () => adapter.startRun({ ...original, applicationRunId: `${original.applicationRunId}-attachment`, input: { ...original.input, attachments: [attachment] } }),
        'UNSUPPORTED_CAPABILITY',
      );
      if (baseline !== undefined) assertEqual(target.providerActivityCount?.(), baseline, 'provider activity after attachment rejection');
    }),
    testCase('streaming', 'normalizes a stream with unique IDs and exactly one terminal event', async (adapter, target) => {
      await adapter.connect(target.connection);
      const session = await adapter.ensureSession(config.scenarios.session(target));
      const handle = await adapter.startRun(config.scenarios.run(target, session));
      const streamInput = config.scenarios.stream?.(target, handle, session) ?? defaultStreamInput(handle, session);
      const collecting = collectRuntimeEvents(adapter.streamRun(streamInput));
      await target.triggerStream?.(handle, session);
      const events = await collecting;
      assert(events.length > 0, 'stream emitted no events');
      assertEqual(new Set(events.map((event) => event.eventId)).size, events.length, 'normalized event IDs must be unique');
      assert(events.every((event) => event.applicationRunId === handle.applicationRunId), 'stream changed application run id');
      assert(events.every((event) => event.externalRunId === handle.externalRunId), 'stream changed external run id');
      assertEqual(events.filter(isTerminalEvent).length, 1, 'terminal event count');
      assert(isTerminalEvent(events.at(-1)!), 'terminal event must end iteration');
      assert(events.every((event) => event.provider?.raw === undefined), 'raw provider payload is enabled by default');
    }),
    testCase('status', 'normalizes provider run status', async (adapter, target) => {
      await adapter.connect(target.connection);
      const capabilities = await adapter.capabilities();
      if (!capabilities.runs.status) return;
      const session = await adapter.ensureSession(config.scenarios.session(target));
      const handle = await adapter.startRun(config.scenarios.run(target, session));
      const input = config.scenarios.status?.(target, handle, session) ?? defaultStatusInput(handle, session);
      const snapshot = await adapter.getRun(input);
      assertEqual(snapshot.applicationRunId, handle.applicationRunId, 'status application run id');
      assertEqual(snapshot.externalRunId, handle.externalRunId, 'status external run id');
      assert(['queued', 'running', 'waiting_for_approval', 'stopping', 'completed', 'failed', 'cancelled', 'unknown'].includes(snapshot.status), 'invalid normalized status');
    }),
    testCase('cancellation', 'cancels one run without changing its ID domains', async (adapter, target) => {
      await adapter.connect(target.connection);
      const capabilities = await adapter.capabilities();
      if (!capabilities.runs.cancel) return;
      const session = await adapter.ensureSession(config.scenarios.session(target));
      const handle = await adapter.startRun(config.scenarios.run(target, session));
      const input = config.scenarios.cancel?.(target, handle, session) ?? defaultCancelInput(handle, session);
      await adapter.cancelRun(input);
      await adapter.cancelRun(input);
      await target.confirmCancellation?.(input);
      if (capabilities.runs.status) {
        const snapshot = await adapter.getRun(input);
        assert(['stopping', 'cancelled', 'completed'].includes(snapshot.status), 'cancellation was reported in an invalid state');
      }
    }),
    testCase('streaming', 'keeps two concurrent sessions and streams isolated', async (adapter, target) => {
      await adapter.connect(target.connection);
      const capabilities = await adapter.capabilities();
      if (!capabilities.runs.streamText) return;
      const firstInput = config.scenarios.session(target);
      const secondInput = { ...config.scenarios.session(target), applicationSessionId: `${firstInput.applicationSessionId}-second` };
      const firstSession = await adapter.ensureSession(firstInput);
      const secondSession = await adapter.ensureSession(secondInput);
      const firstRunInput = config.scenarios.run(target, firstSession);
      const secondRunInput = { ...config.scenarios.run(target, secondSession), applicationRunId: `${firstRunInput.applicationRunId}-second`, idempotencyKey: `${firstRunInput.idempotencyKey}-second` };
      const [firstRun, secondRun] = await Promise.all([adapter.startRun(firstRunInput), adapter.startRun(secondRunInput)]);
      const firstEvents = collectRuntimeEvents(adapter.streamRun(config.scenarios.stream?.(target, firstRun, firstSession) ?? defaultStreamInput(firstRun, firstSession)));
      const secondEvents = collectRuntimeEvents(adapter.streamRun(config.scenarios.stream?.(target, secondRun, secondSession) ?? defaultStreamInput(secondRun, secondSession)));
      await target.triggerStream?.(secondRun, secondSession);
      await target.triggerStream?.(firstRun, firstSession);
      const [first, second] = await Promise.all([firstEvents, secondEvents]);
      assert(first.every((event) => event.applicationRunId === firstRun.applicationRunId && event.externalSessionId === firstSession.externalSessionId), 'first stream received another run or session');
      assert(second.every((event) => event.applicationRunId === secondRun.applicationRunId && event.externalSessionId === secondSession.externalSessionId), 'second stream received another run or session');
    }),
    testCase('resources', 'iterator return releases stream registrations', async (adapter, target) => {
      await adapter.connect(target.connection);
      const capabilities = await adapter.capabilities();
      if (!capabilities.runs.streamText) return;
      const session = await adapter.ensureSession(config.scenarios.session(target));
      const run = await adapter.startRun(config.scenarios.run(target, session));
      const baselineSubscriptions = target.resourceSnapshot?.().activeSubscriptions ?? 0;
      const baselineBodies = target.resourceSnapshot?.().activeResponseBodies ?? 0;
      const iterator = adapter.streamRun(config.scenarios.stream?.(target, run, session) ?? defaultStreamInput(run, session))[Symbol.asyncIterator]();
      await iterator.return?.();
      const snapshot = target.resourceSnapshot?.();
      assertEqual(snapshot?.activeSubscriptions ?? 0, baselineSubscriptions, 'active stream registrations');
      assertEqual(snapshot?.activeResponseBodies ?? 0, baselineBodies, 'active response iterators');
    }),
    testCase('capabilities', 'approval operation exists whenever approvals are advertised', async (adapter, target) => {
      await adapter.connect(target.connection);
      const capabilities = await adapter.capabilities();
      if (!capabilities.runs.approvals) return;
      assert(typeof adapter.resolveApproval === 'function', 'approvals were advertised without a resolution operation');
      if (!target.triggerApproval) return;
      const session = await adapter.ensureSession(config.scenarios.session(target));
      const run = await adapter.startRun(config.scenarios.run(target, session));
      const iterator = adapter.streamRun(config.scenarios.stream?.(target, run, session) ?? defaultStreamInput(run, session))[Symbol.asyncIterator]();
      const next = iterator.next();
      await target.triggerApproval(run, session);
      const event = (await next).value;
      assert(event?.type === 'approval.requested', 'approval stream did not emit approval.requested');
      assert(event.availableDecisions.length > 0, 'approval request advertised no decisions');
      await adapter.resolveApproval!({
        applicationRunId: run.applicationRunId,
        externalRunId: run.externalRunId,
        approvalId: event.approvalId,
        decision: event.availableDecisions[0]!,
      });
      await iterator.return?.();
    }),
    testCase('history', 'history behavior matches the advertised capability', async (adapter, target) => {
      await adapter.connect(target.connection);
      const capabilities = await adapter.capabilities();
      const session = await adapter.ensureSession(config.scenarios.session(target));
      const input = config.scenarios.history?.(target, session) ?? {
        applicationSessionId: session.applicationSessionId,
        externalSessionId: session.externalSessionId,
        providerState: session.providerState,
      };
      if (!capabilities.sessions.history) {
        await assertRuntimeError(() => adapter.getHistory(input), 'UNSUPPORTED_CAPABILITY');
        return;
      }
      const messages = await adapter.getHistory(input);
      assert(Array.isArray(messages) && messages.length > 0, 'advertised history returned no messages');
    }),
    testCase('security', 'public connection output contains no supplied credentials', async (adapter, target) => {
      const info = await adapter.connect(target.connection);
      const serialized = JSON.stringify(info);
      for (const marker of credentialMarkers(target.connection)) {
        assert(!serialized.includes(marker), `connection output exposed credential marker ${marker}`);
      }
    }),
    testCase('resources', 'completion and close release fake-runtime resources', async (adapter, target) => {
      await adapter.connect(target.connection);
      const session = await adapter.ensureSession(config.scenarios.session(target));
      const handle = await adapter.startRun(config.scenarios.run(target, session));
      const input = config.scenarios.stream?.(target, handle, session) ?? defaultStreamInput(handle, session);
      const collecting = collectRuntimeEvents(adapter.streamRun(input));
      await target.triggerStream?.(handle, session);
      await collecting;
      await adapter.close();
      assertResourcesReleased(target.resourceSnapshot?.());
    }),
  ];

  for (const failure of config.scenarios.connectionFailures ?? []) {
    cases.push(testCase('connection', failure.name, async (adapter, target) => {
      await failure.prepare(target);
      await assertRuntimeError(() => adapter.connect(target.connection), failure.expectedCode);
      await adapter.close();
      assertEqual(target.resourceSnapshot?.().openConnections ?? 0, 0, 'failed connection sockets');
      assertEqual(target.resourceSnapshot?.().activeResponseBodies ?? 0, 0, 'failed connection response bodies');
    }));
  }

  return {
    name: config.name,
    cases,
    async run() {
      for (const entry of cases) await entry.run();
    },
  };
}

export type AdapterTestHarness = {
  createAdapter(): Promise<AgentRuntimeAdapter>;
  target: RuntimeTarget;
  testInput: RuntimeUserInput;
  supports: Partial<RuntimeCapabilities>;
  cleanup(): Promise<void>;
};

/** @deprecated Use createRuntimeAdapterConformanceSuite. */
export async function smokeAdapterContract(harness: AdapterTestHarness): Promise<void> {
  const adapter = await harness.createAdapter();
  try {
    const probe = await adapter.probe(harness.target);
    if (probe.matched && !probe.adapterId) throw new RuntimeConformanceAssertionError('matched probe must include adapterId');
    const capabilities = await adapter.capabilities();
    if (capabilities.schemaVersion !== 1) throw new RuntimeConformanceAssertionError('capability schemaVersion must be 1');
    try {
      assertStartRunInput({ applicationRunId: 'contract-run', idempotencyKey: '' });
      throw new RuntimeConformanceAssertionError('empty idempotency key was accepted');
    } catch (error) {
      if (!(error instanceof RuntimeError)) throw error;
    }
    await adapter.close();
  } finally {
    await harness.cleanup();
  }
}

export class RuntimeConformanceAssertionError extends Error {
  override readonly name = 'RuntimeConformanceAssertionError';
}

export async function collectRuntimeEvents(stream: AsyncIterable<RuntimeEvent>, maximum = 20_000): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  for await (const event of stream) {
    events.push(event);
    if (events.length > maximum) throw new RuntimeConformanceAssertionError(`stream exceeded ${maximum} normalized events`);
  }
  return events;
}

export function assertResourcesReleased(snapshot: RuntimeConformanceResourceSnapshot | undefined): void {
  if (!snapshot) return;
  for (const [name, value] of Object.entries(snapshot)) {
    if (value !== undefined && value !== 0) throw new RuntimeConformanceAssertionError(`${name} leaked ${value} resource(s)`);
  }
}

export async function assertRuntimeError(work: () => Promise<unknown>, code: RuntimeError['code']): Promise<RuntimeError> {
  try {
    await work();
  } catch (error) {
    if (!(error instanceof RuntimeError)) throw new RuntimeConformanceAssertionError(`expected RuntimeError ${code}`);
    if (error.code !== code) throw new RuntimeConformanceAssertionError(`expected RuntimeError ${code}, received ${error.code}`);
    return error;
  }
  throw new RuntimeConformanceAssertionError(`expected RuntimeError ${code}, but operation succeeded`);
}

async function withHarness<TTarget extends RuntimeConformanceTarget>(
  config: RuntimeAdapterConformanceConfig<TTarget>,
  caseName: string,
  body: (adapter: AgentRuntimeAdapter, target: TTarget) => Promise<void>,
): Promise<void> {
  const target = await config.createTarget();
  const adapter = await config.createAdapter(target);
  await config.lifecycle?.beforeCase?.(target, caseName);
  try {
    await body(adapter, target);
  } finally {
    await adapter.close().catch(() => undefined);
    await config.lifecycle?.cleanup?.(adapter, target);
  }
}

function defaultStreamInput(run: RuntimeRunHandle, session: RuntimeSession): StreamRuntimeRunInput {
  return {
    applicationRunId: run.applicationRunId,
    externalRunId: run.externalRunId,
    externalSessionId: session.externalSessionId,
    providerState: run.providerState,
  };
}

function defaultStatusInput(run: RuntimeRunHandle, session: RuntimeSession): GetRuntimeRunInput {
  return { ...defaultStreamInput(run, session) };
}

function defaultCancelInput(run: RuntimeRunHandle, session: RuntimeSession): CancelRuntimeRunInput {
  return { ...defaultStreamInput(run, session) };
}

function credentialMarkers(config: RuntimeConnectionConfig): string[] {
  if (!config.auth || config.auth.kind === 'none') return [];
  if (config.auth.kind === 'password') return [config.auth.password, config.auth.username].filter((value): value is string => Boolean(value));
  return [config.auth.token];
}

function containsSecretKey(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsSecretKey);
  return Object.entries(value as Record<string, unknown>).some(([key, nested]) =>
    /^(authorization|password|token|api[_-]?key|cookie|secret|session[_-]?key)$/i.test(key) || containsSecretKey(nested),
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new RuntimeConformanceAssertionError(message);
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (!Object.is(actual, expected)) throw new RuntimeConformanceAssertionError(`${label}: expected ${String(expected)}, received ${String(actual)}`);
}

function assertDeepEqual(actual: unknown, expected: unknown, label: string): void {
  if (stableJson(actual) !== stableJson(expected)) throw new RuntimeConformanceAssertionError(`${label} did not match expected value`);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`).join(',')}}`;
}
