#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
} from 'node:crypto';
import { dirname, resolve } from 'node:path';
import WebSocket from 'ws';
import { SANITIZER_VERSION, sanitizeFrameText, sanitizeFixture } from './lib/sanitize-fixture.mjs';
import {
  buildLegacyDeviceProof,
  loadLegacyOpenClawStore,
} from './lib/openclaw-legacy-store.mjs';

const url = process.env.OPENCLAW_GATEWAY_URL;
const token = process.env.OPENCLAW_GATEWAY_TOKEN;
const protocol = Number(process.env.OPENCLAW_PROTOCOL ?? '4');
const out = process.env.OUT ?? `fixtures/openclaw/v${protocol}/live-capture-candidate.json`;
const legacyStoreDir = process.env.OPENCLAW_CLIENT_STORE_DIR;
const devicePairing = process.env.OPENCLAW_DEVICE_PAIRING ?? (legacyStoreDir ? 'stored' : 'disabled');

if (!url) throw new Error('OPENCLAW_GATEWAY_URL is required');
const legacy = await loadLegacyOpenClawStore(legacyStoreDir);

const frames = [];
const ws = new WebSocket(url, {
  headers: token ? { Authorization: `Bearer ${token}` } : undefined,
});

let challengeNonce;

function record(direction, payload) {
  frames.push({
    direction,
    at: new Date().toISOString(),
    payload: typeof payload === 'string' ? sanitizeFrameText(payload) : sanitizeFixture(payload),
  });
}

function makeDeviceProof(nonce) {
  if (legacy) {
    return buildLegacyDeviceProof({ legacy, token, nonce });
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const rawPublicKey = derivePublicKeyRaw(publicKeyPem);
  const deviceId = createHash('sha256').update(rawPublicKey).digest('hex');
  const signedAt = Date.now();
  const payload = [
    'v2',
    deviceId,
    'gateway-client',
    'backend',
    'operator',
    ['operator.read', 'operator.write'].join(','),
    String(signedAt),
    token ?? '',
    nonce,
  ].join('|');
  const signature = sign(null, Buffer.from(payload, 'utf8'), createPrivateKey(privateKeyPem)).toString('base64url');
  return {
    id: deviceId,
    publicKey: rawPublicKey.toString('base64url'),
    signature,
    signedAt,
    nonce,
  };
}

function derivePublicKeyRaw(publicKeyPem) {
  const key = createPublicKey(publicKeyPem);
  const spki = key.export({ type: 'spki', format: 'der' });
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  if (spki.length === prefix.length + 32 && spki.subarray(0, prefix.length).equals(prefix)) {
    return spki.subarray(prefix.length);
  }
  return spki;
}

const done = new Promise((resolveDone, rejectDone) => {
  const timeout = setTimeout(() => {
    ws.close();
    rejectDone(new Error('Timed out waiting for OpenClaw handshake'));
  }, 15_000);

  ws.on('open', () => record('client.open', { url, protocol }));
  ws.on('error', rejectDone);
  ws.on('message', (data) => {
    const text = data.toString();
    record('server', text);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    if (parsed.event === 'connect.challenge') {
      challengeNonce = parsed.payload?.nonce;
      const scopes = ['operator.read', 'operator.write'];
      const connect = {
        type: 'req',
        id: 'fixture-connect-1',
        method: 'connect',
        params: {
          minProtocol: protocol,
          maxProtocol: protocol,
          client: {
            id: 'gateway-client',
            version: '0.1.0',
            platform: 'node',
            mode: 'backend',
          },
          role: 'operator',
          scopes,
          caps: ['tool-events'],
          auth: token || legacy?.deviceToken ? compactObject({ token, deviceToken: legacy?.deviceToken }) : undefined,
          locale: 'en-US',
          userAgent: '@banzae/agent-runtime-sdk-fixture-capture/0.1.0',
          device: challengeNonce && devicePairing !== 'disabled' ? makeDeviceProof(challengeNonce) : undefined,
        },
      };
      record('client', JSON.stringify(connect));
      ws.send(JSON.stringify(connect));
    }
    if (parsed.type === 'hello-ok' || (parsed.type === 'res' && parsed.id === 'fixture-connect-1')) {
      clearTimeout(timeout);
      ws.close();
      resolveDone();
    }
  });
  ws.on('close', () => {
    clearTimeout(timeout);
    resolveDone();
  });
});

await done;
await mkdir(dirname(resolve(out)), { recursive: true });
await writeFile(
  out,
  `${JSON.stringify(
    sanitizeFixture({
      metadata: {
        runtimeProduct: 'openclaw',
        runtimeVersion: 'unknown',
        protocolVersion: protocol,
        captureDate: new Date().toISOString().slice(0, 10),
        fixtureSchemaVersion: 1,
        sanitizerVersion: SANITIZER_VERSION,
        source: 'sanitized-live-capture',
      },
      frames,
    }),
    null,
    2,
  )}\n`,
  'utf8',
);

console.log(`wrote ${out}`);

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, nested]) => nested !== undefined));
}
