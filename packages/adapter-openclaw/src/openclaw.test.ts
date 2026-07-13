import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { RuntimeError } from '@banzae/agent-runtime-core';
import { OpenClawProtocolRegistry, openClawV3Codec, openClawV4Codec } from './index.js';
import { normalizeOpenClawHistory } from './mapping/transcript.js';

describe('OpenClaw protocol scaffolding', () => {
  it('orders codecs newest first', () => {
    const registry = new OpenClawProtocolRegistry();
    registry.register(openClawV3Codec());
    registry.register(openClawV4Codec());
    expect(registry.preferredVersions()).toEqual([4, 3]);
  });

  it('fails unknown protocol closed', () => {
    const registry = new OpenClawProtocolRegistry();
    registry.register(openClawV4Codec());
    expect(() => registry.require(5)).toThrow(RuntimeError);
  });

  it('passes caller idempotency key through chat.send', () => {
    const request = openClawV4Codec().buildRunStart({
      applicationRunId: 'run-1',
      idempotencyKey: 'forge-runtime-run:run-1',
      session: { applicationSessionId: 'thread-1', externalSessionId: 'session-1', created: false },
      input: { text: 'hello' },
    });
    expect(request.params?.idempotencyKey).toBe('forge-runtime-run:run-1');
  });

  it('includes the session key when aborting OpenClaw chat runs', () => {
    const request = openClawV4Codec().buildCancel({
      applicationRunId: 'run-1',
      externalRunId: 'provider-run-1',
      externalSessionId: 'session-1',
    });

    expect(request).toMatchObject({
      method: 'chat.abort',
      params: {
        sessionKey: 'session-1',
        runId: 'provider-run-1',
      },
    });
  });

  it('maps structured protocol mismatch provider errors', () => {
    const mapped = openClawV4Codec().mapError({
      code: 'INVALID_REQUEST',
      message: 'protocol mismatch',
      details: { expectedProtocol: 3 },
    });

    expect(mapped.code).toBe('PROTOCOL_MISMATCH');
    expect(mapped.message).toBe('protocol mismatch');
    expect(mapped.details?.expectedProtocol).toBe(3);
  });

  it('maps pairing-required provider errors', () => {
    const mapped = openClawV3Codec().mapError({
      code: 'NOT_PAIRED',
      message: 'pairing required: device is not approved yet',
      details: {
        code: 'PAIRING_REQUIRED',
        requestId: 'pairing-request-1',
        deviceId: 'device-1',
        requestedRole: 'operator',
      },
    });

    expect(mapped.code).toBe('PAIRING_REQUIRED');
    expect(mapped.message).toContain('pairing required');
    expect(mapped.details?.requestId).toBe('pairing-request-1');
  });

  it('normalizes history without exposing provider types', () => {
    expect(
      normalizeOpenClawHistory({
        messages: [{ id: '1', role: 'assistant', content: [{ text: 'hello' }] }],
      }),
    ).toEqual([
      {
        id: '1',
        role: 'assistant',
        content: 'hello',
        createdAt: undefined,
        metadata: { provider: 'openclaw', runId: undefined, sequence: undefined },
      },
    ]);
  });

  it('replays the bf1 protocol v3 live hello fixture', async () => {
    const hello = await readHelloFixture('../../../fixtures/openclaw-v3/bf1-live-capture.json', openClawV3Codec());

    expect(hello.protocolVersion).toBe(3);
    expect(hello.runtimeVersion).toBe('2026.4.22');
    expect(hello.methods).toContain('chat.send');
    expect(hello.methods).toContain('agent.wait');
    expect(hello.events).toContain('connect.challenge');
  });

  it('replays the bfp1 protocol v3 live hello fixture', async () => {
    const hello = await readHelloFixture('../../../fixtures/openclaw-v3/bfp1-live-capture.json', openClawV3Codec());

    expect(hello.protocolVersion).toBe(3);
    expect(hello.runtimeVersion).toBe('2026.5.6');
    expect(hello.methods).toContain('tools.invoke');
    expect(hello.methods).toContain('gateway.restart.request');
    expect(hello.events).toContain('voicewake.routing.changed');
  });

  it('replays the bfp1 protocol v4 live hello fixture', async () => {
    const hello = await readHelloFixture('../../../fixtures/openclaw-v4/bfp1-live-capture.json', openClawV4Codec());

    expect(hello.protocolVersion).toBe(4);
    expect(hello.runtimeVersion).toBe('2026.6.11');
    expect(hello.methods).toContain('chat.startup');
    expect(hello.methods).toContain('plugins.sessionAction');
    expect(hello.events).toContain('session.operation');
    expect(hello.events).toContain('talk.event');
  });
});

async function readHelloFixture(path: string, codec: ReturnType<typeof openClawV3Codec> | ReturnType<typeof openClawV4Codec>) {
  const fixture = JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8')) as {
    frames: Array<{ direction: string; payload: string }>;
  };
  const serverResponse = fixture.frames
    .filter((frame) => frame.direction === 'server')
    .map((frame) => JSON.parse(frame.payload) as Record<string, unknown>)
    .find((frame) => frame.type === 'res' && frame.id === 'fixture-connect-1');

  expect(serverResponse?.ok).toBe(true);
  return codec.parseHello(serverResponse?.payload);
}
