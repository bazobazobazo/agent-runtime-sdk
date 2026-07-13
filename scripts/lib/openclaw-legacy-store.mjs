import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export async function loadLegacyOpenClawStore(rootDir, role = 'operator') {
  if (!rootDir) return undefined;
  const identity = JSON.parse(await readFile(join(rootDir, 'identity.json'), 'utf8'));
  const tokenStore = await readOptionalJson(join(rootDir, 'token-store.json'));
  const deviceToken = tokenStore?.tokens?.[role]?.token;
  if (!identity?.deviceId || !identity.publicKeyPem || !identity.privateKeyPem) {
    throw new Error('Legacy OpenClaw identity store is missing required fields');
  }
  return {
    deviceId: identity.deviceId,
    publicKeyPem: identity.publicKeyPem,
    privateKeyPem: identity.privateKeyPem,
    deviceToken: typeof deviceToken === 'string' && deviceToken ? deviceToken : undefined,
  };
}

export async function seedSdkOpenClawState({ sdkStateRoot, endpoint, role = 'operator', legacy }) {
  if (!legacy) return { seeded: false };
  const publicKeyDer = createPublicKey(legacy.publicKeyPem).export({ type: 'spki', format: 'der' });
  const privateKeyDer = createPrivateKey(legacy.privateKeyPem).export({ type: 'pkcs8', format: 'der' });
  const identityKey = sdkStateKey({
    adapterId: 'openclaw',
    purpose: 'openclaw-device-identity',
    endpoint: normalizeEndpoint(endpoint),
  });
  await writeJson(join(sdkStateRoot, 'openclaw.device', `${identityKey}.json`), {
    deviceId: legacy.deviceId,
    publicKeyDer: publicKeyDer.toString('base64url'),
    privateKeyDer: privateKeyDer.toString('base64url'),
  });
  if (legacy.deviceToken) {
    const tokenKey = sdkStateKey({
      adapterId: 'openclaw',
      purpose: 'openclaw-device-token',
      endpoint: normalizeEndpoint(endpoint),
      deviceId: legacy.deviceId,
      role,
    });
    await writeJson(join(sdkStateRoot, 'openclaw.device-token', `${tokenKey}.json`), {
      token: legacy.deviceToken,
      role,
      deviceId: legacy.deviceId,
      updatedAt: new Date().toISOString(),
    });
  }
  return { seeded: true, hasDeviceToken: Boolean(legacy.deviceToken) };
}

export function buildLegacyDeviceProof({ legacy, token, nonce, role = 'operator', scopes = ['operator.read', 'operator.write'] }) {
  const signedAt = Date.now();
  const payload = [
    'v2',
    legacy.deviceId,
    'gateway-client',
    'backend',
    role,
    scopes.join(','),
    String(signedAt),
    token ?? '',
    nonce,
  ].join('|');
  const signature = sign(null, Buffer.from(payload, 'utf8'), createPrivateKey(legacy.privateKeyPem)).toString('base64url');
  return {
    id: legacy.deviceId,
    publicKey: derivePublicKeyRaw(legacy.publicKeyPem).toString('base64url'),
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

async function readOptionalJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function sdkStateKey(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, sortValue(nested)]),
    );
  }
  return value;
}

function normalizeEndpoint(endpoint) {
  const url = new URL(endpoint.replace(/^openclaw\+/, '').replace(/^hermes\+/, '').replace(/^agent\+/, ''));
  url.hash = '';
  url.username = '';
  url.password = '';
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
    url.port = '';
  }
  return url.toString();
}
