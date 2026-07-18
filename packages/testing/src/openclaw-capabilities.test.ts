import { describe, expect, it } from 'vitest';
import { RuntimeError } from '@banzae/agent-runtime-core';
import { createTestDependencies } from '@banzae/agent-runtime-core/testing';
import { OpenClawAdapter } from '../../adapter-openclaw/src/index.js';
import { openClawV3Codec } from '../../adapter-openclaw/src/protocol/v3/codec.js';
import { openClawV4Codec } from '../../adapter-openclaw/src/protocol/v4/codec.js';
import { FakeOpenClawV3Server, FakeOpenClawV4Server } from './fake-openclaw-server.js';

describe.each([
  ['v3', () => new FakeOpenClawV3Server(), openClawV3Codec],
  ['v4', () => new FakeOpenClawV4Server(), openClawV4Codec],
] as const)('OpenClaw %s full capabilities', (label, createServer, createCodec) => {
  it('transports the observed bounded attachment kinds with the exact wire shape', async () => {
    const server = createServer();
    const adapter = new OpenClawAdapter(createTestDependencies({ webSockets: server }), { protocols: [createCodec()] });
    await adapter.connect(server.createTarget().connection);
    const session = await adapter.ensureSession({ applicationSessionId: 'attachment-session' });
    await adapter.startRun({
      applicationRunId: 'attachment-run',
      idempotencyKey: 'attachment-key',
      session,
      input: {
        text: 'inspect attachments',
        attachments: label === 'v4'
          ? [
              { kind: 'image', name: 'pixel.png', mimeType: 'image/png', byteSize: 4, data: Uint8Array.of(1, 2, 3, 4) },
              { kind: 'file', name: 'marker.txt', mimeType: 'text/plain', byteSize: 6, data: new TextEncoder().encode('marker') },
            ]
          : [{ kind: 'image', name: 'pixel.png', mimeType: 'image/png', byteSize: 4, data: Uint8Array.of(1, 2, 3, 4) }],
      },
    });
    expect(server.receivedAttachments).toHaveLength(label === 'v4' ? 2 : 1);
    expect(server.receivedAttachments[0]).toEqual(label === 'v4'
      ? { type: 'image', mimeType: 'image/png', fileName: 'pixel.png', content: 'AQIDBA==' }
      : { type: 'image', mimeType: 'image/png', content: 'AQIDBA==' });
    if (label === 'v4') {
      expect(server.receivedAttachments[1]).toEqual({ type: 'file', mimeType: 'text/plain', fileName: 'marker.txt', content: 'bWFya2Vy' });
    }
    await adapter.close();
    await server.shutdown();
  });

  it('rejects v3 files before provider activity', async () => {
    if (label !== 'v3') return;
    const server = createServer();
    const adapter = new OpenClawAdapter(createTestDependencies({ webSockets: server }), { protocols: [createCodec()] });
    await adapter.connect(server.createTarget().connection);
    const session = await adapter.ensureSession({ applicationSessionId: 'v3-file-session' });
    const activity = server.providerActivity;
    await expect(adapter.startRun({
      applicationRunId: 'v3-file-run', idempotencyKey: 'v3-file-key', session,
      input: { text: 'inspect file', attachments: [{ kind: 'file', name: 'marker.txt', mimeType: 'text/plain', data: new TextEncoder().encode('marker') }] },
    })).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' });
    expect(server.providerActivity).toBe(activity);
    await adapter.close();
    await server.shutdown();
  });

  it('rejects unsafe attachments before provider activity', async () => {
    const server = createServer();
    const adapter = new OpenClawAdapter(createTestDependencies({ webSockets: server }), { protocols: [createCodec()] });
    await adapter.connect(server.createTarget().connection);
    const session = await adapter.ensureSession({ applicationSessionId: 'unsafe-session' });
    const activity = server.providerActivity;
    await expect(adapter.startRun({
      applicationRunId: 'unsafe-run', idempotencyKey: 'unsafe-key', session,
      input: { text: '', attachments: [label === 'v3'
        ? { kind: 'image', name: '../secret.png', mimeType: 'image/png', data: Uint8Array.of(1) }
        : { kind: 'file', name: '../secret.txt', mimeType: 'text/plain', data: Uint8Array.of(1) }] },
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(server.providerActivity).toBe(activity);
    await adapter.close();
    await server.shutdown();
  });

  it('creates, reads, updates, pauses, triggers, histories, and deletes schedules', async () => {
    const server = createServer();
    const adapter = new OpenClawAdapter(createTestDependencies({ webSockets: server }), { protocols: [createCodec()] });
    await adapter.connect(server.createTarget().connection);
    const created = await adapter.createSchedule({
      idempotencyKey: 'schedule-key', name: 'daily marker',
      timing: { kind: 'cron', expression: '0 9 * * *', timezone: 'UTC' },
      payload: { text: 'emit marker', sessionTarget: 'isolated' },
    });
    if (label === 'v3') {
      const duplicate = await adapter.createSchedule({
        idempotencyKey: 'schedule-key', name: 'daily marker',
        timing: { kind: 'cron', expression: '0 9 * * *', timezone: 'UTC' }, payload: { text: 'emit marker' },
      });
      expect(duplicate.externalScheduleId).toBe(created.externalScheduleId);
    }
    expect(server.schedules).toHaveLength(1);
    await expect(adapter.getSchedule({ externalScheduleId: created.externalScheduleId })).resolves.toMatchObject({ status: 'enabled' });
    await expect(adapter.updateSchedule({ externalScheduleId: created.externalScheduleId, name: 'updated marker' })).resolves.toMatchObject({ name: 'updated marker' });
    await adapter.pauseSchedule({ externalScheduleId: created.externalScheduleId });
    await expect(adapter.triggerSchedule({ externalScheduleId: created.externalScheduleId })).resolves.toMatchObject({ status: 'completed' });
    await expect(adapter.getScheduleHistory({ externalScheduleId: created.externalScheduleId })).resolves.toMatchObject({ executions: [{ status: 'completed' }] });
    await adapter.deleteSchedule({ externalScheduleId: created.externalScheduleId });
    expect(server.schedules).toHaveLength(0);
    await adapter.close();
    await server.shutdown();
  });

  it('normalizes unsafe schedule timing as a request error', async () => {
    const server = createServer();
    const adapter = new OpenClawAdapter(createTestDependencies({ webSockets: server }), { protocols: [createCodec()] });
    await adapter.connect(server.createTarget().connection);
    await expect(adapter.createSchedule({ idempotencyKey: 'bad', timing: { kind: 'interval', everyMs: 0 }, payload: { text: 'x' } }))
      .rejects.toBeInstanceOf(RuntimeError);
    await adapter.close();
    await server.shutdown();
  });

  it('reconciles uncertain schedule acceptance without duplicate creation', async () => {
    const server = createServer();
    server.options.uncertainScheduleCreation = true;
    const adapter = new OpenClawAdapter(createTestDependencies({ webSockets: server }), { protocols: [createCodec()] });
    await adapter.connect(server.createTarget().connection);
    const creation = adapter.createSchedule({ idempotencyKey: 'uncertain-key', timing: { kind: 'once', at: '2026-07-18T00:00:00Z' }, payload: { text: 'marker' } });
    if (label === 'v3') await expect(creation).resolves.toMatchObject({ idempotencyKey: 'uncertain-key' });
    else await expect(creation).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(server.schedules).toHaveLength(1);
    await adapter.close(); await server.shutdown();
  });

  it('normalizes rate limits and expired tokens safely', () => {
    const codec = createCodec();
    expect(codec.mapError({ code: 'RATE_LIMITED', message: 'rate limit', retryAfterMs: 250 })).toMatchObject({ code: 'RATE_LIMITED', retryable: true, retryAfterMs: 250 });
    expect(codec.mapError({ code: 'TOKEN_EXPIRED', message: 'token expired: provider-secret' })).toMatchObject({ code: 'AUTHENTICATION_FAILED', retryable: false });
  });
});
