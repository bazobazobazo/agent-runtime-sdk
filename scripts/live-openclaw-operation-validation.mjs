#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  IncrementingIdGenerator,
  noopLogger,
  systemClock,
} from '../packages/core/dist/index.js';
import { OpenClawAdapter } from '../packages/adapter-openclaw/dist/index.js';
import {
  FetchHttpTransport,
  NodeFileStateStore,
  NodeMemorySecretStore,
  WsWebSocketFactory,
  nodeCrypto,
} from '../packages/node/dist/index.js';

const endpoint = normalizeEndpoint(required('OPENCLAW_ENDPOINT'));
const token = required('OPENCLAW_GATEWAY_TOKEN').trim();
const stateRoot = required('OPENCLAW_STATE_ROOT');
const alias = required('OPENCLAW_GATEWAY_ALIAS');
const protocolVersion = Number(required('OPENCLAW_PROTOCOL_VERSION'));
const operation = required('LIVE_OPERATION');
const startedAt = new Date().toISOString();
const diagnostics = [];
const pending = new Map();
const identity = await readIdentity(stateRoot);
const baseWebSockets = new WsWebSocketFactory();
const webSockets = {
  async connect(input) {
    const connection = await baseWebSockets.connect(input);
    return {
      async send(data) {
        captureRequest(data);
        await connection.send(data);
      },
      async *events() {
        for await (const event of connection.events()) {
          if (event.type === 'message') captureResponse(event.data);
          yield event;
        }
      },
      close: (code, reason) => connection.close(code, reason),
    };
  },
};

let adapter;
let accepted = false;
let externalRunId;
let externalSessionId;
let terminalResult;
let cleanupResult = 'not-opened';
let result;
let caughtError;
try {
  result = await runOperation();
} catch (error) {
  caughtError = safeError(error);
  process.exitCode = 1;
} finally {
  if (adapter) {
    try {
      await adapter.close();
      cleanupResult = 'adapter-closed';
    } catch {
      cleanupResult = 'adapter-close-failed';
    }
  }
}
process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  timestamp: startedAt,
  gatewayAlias: alias,
  protocolVersion,
  operation,
  deviceIdSuffix: identity.deviceId.slice(-16),
  credentialStateSource: `sdk-state:${alias}`,
  requestedScopes: scopesFor(operation),
  tokenPresent: token.length > 0,
  accepted,
  externalRunIdHash: externalRunId ? hash(externalRunId) : null,
  sessionIdentifierHash: externalSessionId ? hash(externalSessionId) : null,
  terminalResult: terminalResult ?? null,
  cleanupResult,
  diagnostics,
  ...(caughtError ? { error: caughtError } : { result }),
}, null, 2)}\n`);

async function runOperation() {
  const scopes = scopesFor(operation);
  adapter = new OpenClawAdapter({
    state: new NodeFileStateStore(stateRoot),
    secrets: new NodeMemorySecretStore(),
    logger: noopLogger,
    clock: systemClock,
    ids: new IncrementingIdGenerator(),
    http: new FetchHttpTransport(),
    webSockets,
    crypto: nodeCrypto,
  }, { scopes, requestTimeoutMs: 30_000 });
  const connection = await adapter.connect({
    target: { endpoint, adapterHint: 'openclaw', transportHint: 'websocket' },
    auth: { kind: 'token', token },
    requestedCapabilities: capabilitiesFor(operation),
    options: { protocolVersions: [protocolVersion] },
  }, { timeoutMs: 30_000 });
  if (connection.descriptor.protocolVersion !== String(protocolVersion)) {
    throw Object.assign(new Error('Unexpected protocol version'), { code: 'PROTOCOL_MISMATCH' });
  }
  if (operation === 'health') {
    const health = await adapter.health({ timeoutMs: 30_000 });
    return { connectionResult: 'connected', healthStatus: health.status };
  }
  if (operation === 'devices') return deviceListResult();
  if (operation === 'text') return chatResult('text');
  if (operation === 'image') return chatResult('image');
  if (operation === 'file') return chatResult('file');
  if (operation === 'schedule') return scheduleResult();
  throw Object.assign(new Error('Unsupported validation operation'), { code: 'INVALID_CONFIGURATION' });
}

async function deviceListResult() {
  const dispatcher = adapter?.connected?.dispatcher;
  if (!dispatcher) throw Object.assign(new Error('Connected dispatcher unavailable'), { code: 'INTERNAL' });
  const payload = await dispatcher.request({ id: `device-list:${randomUUID()}`, method: 'device.pair.list', params: {} });
  const paired = Array.isArray(payload?.paired) ? payload.paired : [];
  const match = paired.find((entry) => (entry?.deviceId ?? entry?.id) === identity.deviceId);
  return {
    connectionResult: 'connected',
    pairedDeviceMatched: Boolean(match),
    approvedScopes: Array.isArray(match?.scopes) ? [...match.scopes].sort() : [],
    role: typeof match?.role === 'string' ? match.role : null,
  };
}

async function chatResult(kind) {
  const suffix = randomUUID();
  const session = await adapter.ensureSession({
    applicationSessionId: `banzae-attachment-validation-${alias}-${kind}-${suffix}`,
    title: 'Banzae attachment compatibility validation',
  }, { timeoutMs: 30_000 });
  externalSessionId = session.externalSessionId;
  const marker = kind === 'file' ? 'BANZAE_FILE_COMPATIBILITY_OK' : kind === 'image' ? 'BANZAE_IMAGE_COMPATIBILITY_OK' : 'BANZAE_RUNTIME_COMPATIBILITY_OK';
  const attachments = kind === 'image'
    ? [{ kind: 'image', name: 'synthetic-marker.png', mimeType: 'image/png', data: syntheticMarkerPng(marker) }]
    : kind === 'file'
      ? [{ kind: 'file', name: 'synthetic-marker.txt', mimeType: 'text/plain', data: new TextEncoder().encode(marker) }]
      : undefined;
  const applicationRunId = `banzae-attachment-validation-run-${suffix}`;
  const beforeSend = diagnostics.filter((entry) => entry.method === 'chat.send').length;
  const run = await adapter.startRun({
    applicationRunId,
    idempotencyKey: `banzae-attachment-validation-key-${suffix}`,
    session,
    input: {
      text: `Return exactly the synthetic marker contained in the ${kind === 'text' ? 'request' : kind}. Do not use tools or perform external actions.${kind === 'text' ? ` Marker: ${marker}` : ''}`,
      ...(attachments ? { attachments } : {}),
    },
  }, { timeoutMs: 30_000 });
  accepted = true;
  externalRunId = run.externalRunId;
  const snapshot = await waitForTerminal({ applicationRunId, run, session });
  terminalResult = snapshot.status;
  if (snapshot.status !== 'completed') throw Object.assign(new Error('Run did not complete successfully'), { code: snapshot.error?.code ?? 'PROVIDER_ERROR' });
  let output = snapshot.output?.trim();
  if (!output) {
    const history = await adapter.getHistory({ applicationSessionId: session.applicationSessionId, externalSessionId: session.externalSessionId, limit: 20 }, { timeoutMs: 30_000 });
    output = [...history.messages].reverse().find((message) => message.role === 'assistant')?.content?.trim();
  }
  const chatSendCount = diagnostics.filter((entry) => entry.method === 'chat.send').length - beforeSend;
  return {
    connectionResult: 'connected',
    markerMatchedExactly: output === marker,
    markerContained: typeof output === 'string' && output.includes(marker),
    outputLength: typeof output === 'string' ? output.length : 0,
    outputHash: typeof output === 'string' ? hash(output) : null,
    providerSubmissionCount: chatSendCount,
    noDuplicate: chatSendCount === 1,
    noOutcomeUnknown: snapshot.status !== 'unknown',
  };
}

async function waitForTerminal({ applicationRunId, run, session }) {
  const deadline = Date.now() + 120_000;
  let snapshot = run;
  while (!['completed', 'failed', 'cancelled'].includes(snapshot.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    snapshot = await adapter.getRun({
      applicationRunId,
      externalRunId: run.externalRunId,
      externalSessionId: session.externalSessionId,
      providerState: run.providerState,
    }, { timeoutMs: 120_000 });
  }
  if (!['completed', 'failed', 'cancelled'].includes(snapshot.status)) {
    throw Object.assign(new Error('Run terminal result was not observed'), { code: 'OUTCOME_UNKNOWN' });
  }
  return snapshot;
}

async function scheduleResult() {
  let externalScheduleId;
  let deleted = false;
  try {
    const before = await adapter.listSchedules({ limit: 100 }, { timeoutMs: 30_000 });
    const at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const created = await adapter.createSchedule({
      idempotencyKey: `banzae-schedule-validation-${randomUUID()}`,
      name: 'Banzae harmless schedule validation',
      timing: { kind: 'once', at },
      payload: { text: 'BANZAE_SCHEDULE_COMPATIBILITY_OK', kind: 'system-event' },
    }, { timeoutMs: 30_000 });
    externalScheduleId = created.externalScheduleId;
    accepted = true;
    if (adapter.updateSchedule) {
      await adapter.updateSchedule({ externalScheduleId, timing: { kind: 'once', at: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString() } }, { timeoutMs: 30_000 });
    }
    if (adapter.disableSchedule) await adapter.disableSchedule({ externalScheduleId }, { timeoutMs: 30_000 });
    if (adapter.enableSchedule) await adapter.enableSchedule({ externalScheduleId }, { timeoutMs: 30_000 });
    if (adapter.getScheduleHistory) await adapter.getScheduleHistory({ externalScheduleId, limit: 10 }, { timeoutMs: 30_000 });
    await adapter.deleteSchedule({ externalScheduleId }, { timeoutMs: 30_000 });
    deleted = true;
    const after = await adapter.listSchedules({ limit: 100 }, { timeoutMs: 30_000 });
    return {
      connectionResult: 'connected',
      listSucceeded: Array.isArray(before.schedules),
      created: true,
      updated: Boolean(adapter.updateSchedule),
      disabledEnabled: Boolean(adapter.disableSchedule && adapter.enableSchedule),
      deleted,
      orphanRemaining: after.schedules.some((entry) => entry.externalScheduleId === externalScheduleId),
      externalScheduleIdHash: hash(externalScheduleId),
    };
  } finally {
    if (externalScheduleId && !deleted) {
      try {
        await adapter.deleteSchedule({ externalScheduleId }, { timeoutMs: 30_000 });
      } catch {}
    }
  }
}

function captureRequest(data) {
  const frame = parseFrame(data);
  if (frame?.type !== 'req' || typeof frame.id !== 'string' || typeof frame.method !== 'string') return;
  const attachment = Array.isArray(frame.params?.attachments) ? frame.params.attachments[0] : undefined;
  const diagnostic = {
    timestamp: new Date().toISOString(),
    method: frame.method,
    deviceIdSuffix: identity.deviceId.slice(-16),
    requestedScopes: scopesFor(operation),
    protocolVersion,
    attachmentKind: typeof attachment?.type === 'string' ? attachment.type : null,
    mimeType: typeof attachment?.mimeType === 'string' ? attachment.mimeType : null,
    declaredSize: typeof attachment?.content === 'string' ? Math.floor(attachment.content.length * 3 / 4) : null,
    responseCode: null,
    normalizedErrorCode: null,
    accepted: false,
  };
  diagnostics.push(diagnostic);
  pending.set(frame.id, diagnostic);
}

function captureResponse(data) {
  const frame = parseFrame(data);
  if (frame?.type !== 'res' || typeof frame.id !== 'string') return;
  const diagnostic = pending.get(frame.id);
  if (!diagnostic) return;
  const rawCode = typeof frame.error?.code === 'string' ? frame.error.code : frame.ok === false ? 'UNKNOWN_ERROR' : 'OK';
  diagnostic.responseCode = rawCode;
  diagnostic.accepted = frame.ok !== false && !frame.error;
  if (frame.error) diagnostic.rawErrorMessage = sanitizeMessage(frame.error.message);
  pending.delete(frame.id);
}

function parseFrame(data) {
  try {
    const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function scopesFor(value) {
  return value === 'schedule' || value === 'devices'
    ? ['operator.read', 'operator.write', 'operator.admin']
    : value === 'health'
      ? ['operator.read']
      : ['operator.read', 'operator.write'];
}

function capabilitiesFor(value) {
  if (value === 'image') return ['sessions.create', 'runs.start', 'runs.status', 'output.text', 'input.images'];
  if (value === 'file') return ['sessions.create', 'runs.start', 'runs.status', 'output.text', 'input.files'];
  if (value === 'text') return ['sessions.create', 'runs.start', 'runs.status', 'output.text'];
  return undefined;
}

async function readIdentity(root) {
  const directory = join(root, 'openclaw.device');
  const files = (await readdir(directory)).filter((entry) => entry.endsWith('.json'));
  if (files.length !== 1) throw Object.assign(new Error('Expected one SDK device identity'), { code: 'INVALID_CONFIGURATION' });
  const value = JSON.parse(await readFile(join(directory, files[0]), 'utf8'));
  if (typeof value.deviceId !== 'string') throw Object.assign(new Error('SDK device identity is invalid'), { code: 'INVALID_CONFIGURATION' });
  return value;
}

function safeError(error) {
  const code = typeof error?.code === 'string' ? error.code : 'INTERNAL';
  for (const diagnostic of [...diagnostics].reverse()) {
    if (diagnostic.normalizedErrorCode == null && diagnostic.responseCode && diagnostic.responseCode !== 'OK') {
      diagnostic.normalizedErrorCode = code;
      break;
    }
  }
  return { code, message: sanitizeMessage(error?.message), retryable: error?.retryable === true };
}

function sanitizeMessage(value) {
  if (typeof value !== 'string') return null;
  return value
    .replace(/(?:wss?|https?):\/\/\S+/gi, '[endpoint]')
    .replace(/[A-Fa-f0-9]{32,}/g, '[identifier]')
    .replace(/(?:token|authorization|signature|private.?key)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .slice(0, 240);
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function syntheticMarkerPng(marker) {
  const glyphs = {
    A: ['01110','10001','10001','11111','10001','10001','10001'],
    B: ['11110','10001','10001','11110','10001','10001','11110'],
    C: ['01111','10000','10000','10000','10000','10000','01111'],
    E: ['11111','10000','10000','11110','10000','10000','11111'],
    G: ['01111','10000','10000','10111','10001','10001','01111'],
    I: ['11111','00100','00100','00100','00100','00100','11111'],
    K: ['10001','10010','10100','11000','10100','10010','10001'],
    L: ['10000','10000','10000','10000','10000','10000','11111'],
    M: ['10001','11011','10101','10101','10001','10001','10001'],
    N: ['10001','11001','10101','10011','10001','10001','10001'],
    O: ['01110','10001','10001','10001','10001','10001','01110'],
    P: ['11110','10001','10001','11110','10000','10000','10000'],
    T: ['11111','00100','00100','00100','00100','00100','00100'],
    Y: ['10001','10001','01010','00100','00100','00100','00100'],
    Z: ['11111','00001','00010','00100','01000','10000','11111'],
    _: ['00000','00000','00000','00000','00000','00000','11111'],
  };
  const scale = 10;
  const padding = 50;
  const width = padding * 2 + marker.length * 6 * scale;
  const height = padding * 2 + 7 * scale;
  const scanlines = Buffer.alloc((width * 3 + 1) * height, 255);
  for (let y = 0; y < height; y += 1) scanlines[y * (width * 3 + 1)] = 0;
  for (let index = 0; index < marker.length; index += 1) {
    const glyph = glyphs[marker[index]];
    if (!glyph) throw Object.assign(new Error('Synthetic marker glyph is unavailable'), { code: 'INVALID_CONFIGURATION' });
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] !== '1') continue;
        for (let sy = 0; sy < scale; sy += 1) {
          for (let sx = 0; sx < scale; sx += 1) {
            const x = padding + (index * 6 + column) * scale + sx;
            const y = padding + row * scale + sy;
            const offset = y * (width * 3 + 1) + 1 + x * 3;
            scanlines[offset] = 0;
            scanlines[offset + 1] = 0;
            scanlines[offset + 2] = 0;
          }
        }
      }
    }
  }
  const signature = Buffer.from('89504e470d0a1a0a', 'hex');
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return new Uint8Array(Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(scanlines)), pngChunk('IEND', Buffer.alloc(0))]));
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, crc]);
}

function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  return (value ^ 0xffffffff) >>> 0;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw Object.assign(new Error(`Missing ${name}`), { code: 'INVALID_CONFIGURATION' });
  return value;
}

function normalizeEndpoint(value) {
  const parsed = new URL(value.trim());
  if (parsed.protocol === 'http:') parsed.protocol = 'ws:';
  if (parsed.protocol === 'https:') parsed.protocol = 'wss:';
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    throw Object.assign(new Error('Unsupported gateway endpoint scheme'), { code: 'INVALID_CONFIGURATION' });
  }
  return parsed.toString().replace(/\/+$/, '');
}
