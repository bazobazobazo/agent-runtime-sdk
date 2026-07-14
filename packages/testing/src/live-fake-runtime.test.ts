import { describe, expect, it } from 'vitest';
import { createTestDependencies } from '@banzae/agent-runtime-core/testing';
import { HermesAdapter } from '../../adapter-hermes/src/index.js';
import { OpenClawAdapter } from '../../adapter-openclaw/src/index.js';
import { openClawV3Codec } from '../../adapter-openclaw/src/protocol/v3/codec.js';
import { openClawV4Codec } from '../../adapter-openclaw/src/protocol/v4/codec.js';
import { FakeHermesServer } from './fake-hermes-server.js';
import { FakeOpenClawV3Server, FakeOpenClawV4Server } from './fake-openclaw-server.js';
import { runLiveCompatibility, type LiveCompatibilityCheck } from './live-compatibility.js';

describe('live harness against fake production adapters', () => {
  it.each([3, 4] as const)('produces a read-only OpenClaw v%s report without external I/O', async (version) => {
    const server = version === 3
      ? new FakeOpenClawV3Server({ authToken: `fake-v${version}-token` })
      : new FakeOpenClawV4Server({ authToken: `fake-v${version}-token` });
    const adapter = new OpenClawAdapter(createTestDependencies({ webSockets: server }), {
      protocols: [version === 3 ? openClawV3Codec() : openClawV4Codec()],
    });
    const report = await runLiveCompatibility({
      adapter,
      target: {
        adapterId: 'openclaw', endpoint: `wss://openclaw-v${version}.example.test`, expectedProtocol: String(version),
        mutationPolicy: readOnlyPolicy(),
      },
      metadata: metadata('openclaw'),
      checks: readOnlyChecks({
        target: { endpoint: `wss://openclaw-v${version}.example.test` },
        auth: { kind: 'token', token: `fake-v${version}-token` },
        options: { protocolVersions: [version] },
      }),
    });
    expect(report.summary.requiredChecksPassed).toBe(true);
    expect(report.target.protocolVersion).toBe(String(version));
    expect(server.openConnectionCount).toBe(0);
    expect(server.pendingRequestCount).toBe(0);
    await server.shutdown();
  });

  it('produces a read-only Hermes report and closes every response body', async () => {
    const server = new FakeHermesServer();
    const adapter = new HermesAdapter(createTestDependencies({ http: server }), {
      baseUrl: 'https://hermes.example.test',
    });
    const report = await runLiveCompatibility({
      adapter,
      target: { adapterId: 'hermes', endpoint: 'https://hermes.example.test', mutationPolicy: readOnlyPolicy() },
      metadata: metadata('hermes'),
      checks: readOnlyChecks({ target: { endpoint: 'https://hermes.example.test' }, auth: { kind: 'bearer', token: 'fake-token' } }),
    });
    expect(report.summary.requiredChecksPassed).toBe(true);
    expect(report.target.runtimeProduct).toBe('hermes-agent');
    expect(server.activeResponseBodies).toBe(0);
    expect(server.requests.every((request) => request.method === 'GET')).toBe(true);
    await server.shutdown();
  });
});

function readOnlyChecks(connection: Parameters<OpenClawAdapter['connect']>[0]): LiveCompatibilityCheck[] {
  return [
    {
      id: 'connect', category: 'connection', required: true, destructive: false,
      async run({ adapter, signal, state }) {
        const result = await adapter.connect(connection, { signal });
        state.set('connection', result);
      },
    },
    {
      id: 'capabilities', category: 'capabilities', required: true, destructive: false,
      async run({ adapter, state }) { state.set('capabilities', await adapter.capabilities()); },
    },
    {
      id: 'health', category: 'health', required: true, destructive: false,
      async run({ adapter, signal }) {
        const health = await adapter.health({ signal });
        if (health.status === 'unavailable') throw new Error('health unavailable');
      },
    },
  ];
}

function readOnlyPolicy() {
  return { allowSessionCreation: false, allowRunCreation: false, allowCancellation: false, allowApproval: false };
}

function metadata(adapterId: string) {
  return {
    commitSha: 'fake-commit', packageVersion: '0.1.0', nodeVersion: 'v22.13.0', platform: 'linux',
    endpointFingerprint: `${adapterId}-`.padEnd(64, 'a'),
  };
}
