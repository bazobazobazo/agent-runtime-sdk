import {
  type RuntimeCapabilities,
  type RuntimeConnectionConfig,
} from '@banzae/agent-runtime-core';
import type { RuntimeRunHandle, RuntimeSession } from '@banzae/agent-runtime-core';
import { createTestDependencies } from '@banzae/agent-runtime-core/testing';
import { HermesAdapter } from '../../../adapter-hermes/src/index.js';
import { mapHermesCapabilities } from '../../../adapter-hermes/src/mapping/capabilities.js';
import { OpenClawAdapter } from '../../../adapter-openclaw/src/index.js';
import { openClawV3Codec } from '../../../adapter-openclaw/src/protocol/v3/codec.js';
import { openClawV4Codec } from '../../../adapter-openclaw/src/protocol/v4/codec.js';
import {
  createRuntimeAdapterConformanceSuite,
  type RuntimeConformanceTarget,
} from '../contract.js';
import { DeterministicRuntimeClock, DeterministicRuntimeIdGenerator } from '../deterministic.js';
import { FakeHermesServer } from '../fake-hermes-server.js';
import { FakeOpenClawV3Server, FakeOpenClawV4Server } from '../fake-openclaw-server.js';

export type OpenClawConformanceTarget = RuntimeConformanceTarget & {
  server: FakeOpenClawV3Server | FakeOpenClawV4Server;
};

export type HermesConformanceTarget = RuntimeConformanceTarget & {
  server: FakeHermesServer;
};

export function createOpenClawV3ConformanceSuite() {
  return createOpenClawConformanceSuite(3);
}

export function createOpenClawV4ConformanceSuite() {
  return createOpenClawConformanceSuite(4);
}

export function createHermesConformanceSuite() {
  return createRuntimeAdapterConformanceSuite<HermesConformanceTarget>({
    name: 'Hermes Runs HTTP/SSE',
    createTarget() {
      const server = new FakeHermesServer();
      const connection: RuntimeConnectionConfig = {
        target: { endpoint: 'https://hermes-conformance.example.test', transportHint: 'http' },
        auth: { kind: 'bearer', token: 'conformance-hermes-token' },
      };
      return {
        server,
        connection,
        resourceSnapshot: () => server.resourceSnapshot(),
        providerActivityCount: () => server.requests.length,
        receivedIdempotencyKeys: () => server.requests
          .filter((request) => new URL(request.url).pathname === '/v1/runs')
          .map((request) => request.headers?.['Idempotency-Key'])
          .filter((value): value is string => Boolean(value)),
        triggerStream(run, session) {
          const fakeRun = server.runs.get(run.externalRunId);
          if (!fakeRun) throw new Error('Fake Hermes run missing');
          fakeRun.status = 'completed';
          fakeRun.output = 'Hermes conformance output';
          fakeRun.sessionId = session.externalSessionId;
          fakeRun.events = [
            { id: 'event-1', event: 'message.delta', data: { event: 'message.delta', run_id: run.externalRunId, session_id: session.externalSessionId, delta: 'Hermes ' } },
            { id: 'event-2', event: 'message.delta', data: { event: 'message.delta', run_id: run.externalRunId, session_id: session.externalSessionId, delta: 'conformance' } },
            { id: 'event-3', event: 'run.completed', data: { event: 'run.completed', run_id: run.externalRunId, session_id: session.externalSessionId, output: fakeRun.output } },
          ];
        },
        triggerApproval(run, session) {
          const fakeRun = server.runs.get(run.externalRunId);
          if (!fakeRun) throw new Error('Fake Hermes approval run missing');
          fakeRun.status = 'waiting_for_approval';
          fakeRun.sessionId = session.externalSessionId;
          fakeRun.events = [{
            id: `${run.externalRunId}-approval`,
            event: 'approval.request',
            data: {
              event: 'approval.request',
              run_id: run.externalRunId,
              session_id: session.externalSessionId,
              description: 'Approve the synthetic conformance action',
              choices: ['once', 'session', 'always', 'deny'],
            },
          }];
        },
      };
    },
    createAdapter(target) {
      return new HermesAdapter(createTestDependencies({
        http: target.server,
        clock: new DeterministicRuntimeClock(),
        ids: new DeterministicRuntimeIdGenerator('hermes-event'),
      }), { baseUrl: target.connection.target.endpoint });
    },
    expectedCapabilities: (target) => mapHermesCapabilities(target.server.capabilities),
    scenarios: {
      ...commonScenarios('hermes'),
      connectionFailures: [
        { name: 'rejects invalid credentials', expectedCode: 'AUTHENTICATION_FAILED' as const, prepare: (target: HermesConformanceTarget) => { target.server.failAuth = true; } },
        { name: 'rejects permission failures', expectedCode: 'PERMISSION_DENIED' as const, prepare: (target: HermesConformanceTarget) => { target.server.failPermission = true; } },
        { name: 'rejects malformed capability responses and cleans up', expectedCode: 'INVALID_RESPONSE' as const, prepare: (target: HermesConformanceTarget) => { target.server.capabilities = { object: 'partial' }; } },
      ],
    },
    lifecycle: { cleanup: async (_adapter, target) => target.server.shutdown() },
  });
}

function createOpenClawConformanceSuite(version: 3 | 4) {
  const codec = version === 3 ? openClawV3Codec() : openClawV4Codec();
  return createRuntimeAdapterConformanceSuite<OpenClawConformanceTarget>({
    name: `OpenClaw Gateway v${version}`,
    createTarget() {
      const server = version === 3
        ? new FakeOpenClawV3Server({ authToken: `conformance-openclaw-v${version}-token` })
        : new FakeOpenClawV4Server({ authToken: `conformance-openclaw-v${version}-token` });
      const base = server.createTarget();
      return {
        ...base,
        server,
        triggerStream(run) { server.emitUnrelatedEvent(); server.emitRunSuccess(run.externalRunId, { duplicate: true }); },
        confirmCancellation(input) {
          const status = server.runs.get(input.externalRunId)?.status;
          if (status !== 'cancelled') throw new Error(`Fake OpenClaw cancellation was not confirmed: ${String(status)}`);
        },
      };
    },
    createAdapter(target) {
      return new OpenClawAdapter(createTestDependencies({
        webSockets: target.server,
        clock: new DeterministicRuntimeClock(),
        ids: new DeterministicRuntimeIdGenerator(`openclaw-v${version}-event`),
      }), { protocols: [codec] });
    },
    expectedCapabilities: openClawCapabilities(version),
    scenarios: {
      ...commonScenarios(`openclaw-v${version}`),
      connectionFailures: [
        { name: 'rejects invalid credentials', expectedCode: 'AUTHENTICATION_FAILED' as const, prepare: (target: OpenClawConformanceTarget) => { target.server.options.failureMode = 'authentication-failed'; } },
        { name: 'rejects permission failures', expectedCode: 'PERMISSION_DENIED' as const, prepare: (target: OpenClawConformanceTarget) => { target.server.options.failureMode = 'permission-denied'; } },
        { name: 'rejects protocol mismatch without misleading downgrade', expectedCode: 'PROTOCOL_MISMATCH' as const, prepare: (target: OpenClawConformanceTarget) => { target.server.options.failureMode = 'protocol-mismatch'; } },
      ],
    },
    lifecycle: { cleanup: async (_adapter, target) => target.server.shutdown() },
  });
}

function commonScenarios(prefix: string) {
  return {
    session: () => ({ applicationSessionId: `${prefix}-application-session` }),
    run: (_target: RuntimeConformanceTarget, session: RuntimeSession) => ({
      applicationRunId: `${prefix}-application-run`,
      idempotencyKey: `${prefix}-caller-idempotency-key`,
      session,
      input: { text: 'Run the provider-neutral conformance scenario.' },
    }),
    stream: (_target: RuntimeConformanceTarget, run: RuntimeRunHandle, session: RuntimeSession) => ({
      applicationRunId: run.applicationRunId,
      externalRunId: run.externalRunId,
      externalSessionId: session.externalSessionId,
      providerState: run.providerState,
    }),
  };
}

function openClawCapabilities(protocol: 3 | 4): RuntimeCapabilities {
  return {
    schemaVersion: 1,
    sessions: { create: true, resume: true, history: true, fork: false },
    runs: { start: true, status: true, stream: true, cancel: true, approvals: false },
    input: { text: true, images: false, files: false },
    output: { text: true, reasoning: false, tools: false, usage: false },
    health: { liveness: true, readiness: false },
    extensions: { 'openclaw.cron': false, 'openclaw.channels': false, 'openclaw.protocol': protocol },
  };
}
