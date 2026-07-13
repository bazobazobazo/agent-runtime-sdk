import {
  RuntimeError,
  assertStartRunInput,
  connectionFingerprint,
  normalizeEndpoint,
  validateInputCapabilities,
  withDeadline,
  type AgentRuntimeAdapter,
  type CancelRuntimeRunInput,
  type ConnectOptions,
  type EnsureSessionInput,
  type GetRuntimeHistoryInput,
  type GetRuntimeRunInput,
  type OperationOptions,
  type ProbeOptions,
  type RuntimeAdapterDependencies,
  type RuntimeCapabilities,
  type RuntimeConnectionConfig,
  type RuntimeConnectionInfo,
  type RuntimeEvent,
  type RuntimeHealth,
  type RuntimeMessage,
  type RuntimeProbeResult,
  type RuntimeRunHandle,
  type RuntimeRunSnapshot,
  type RuntimeSession,
  type RuntimeTarget,
  type StartRuntimeRunInput,
  type StreamRuntimeRunInput,
  type RuntimeWebSocketConnection,
} from '@banzae/agent-runtime-core';
import { OpenClawRequestManager } from './transport/request-manager.js';
import { OpenClawProtocolRegistry } from './protocol/registry.js';
import { openClawV3Codec } from './protocol/v3/codec.js';
import { openClawV4Codec } from './protocol/v4/codec.js';
import type { OpenClawHello, OpenClawProtocolCodec } from './protocol/types.js';
import { normalizeOpenClawHistory } from './mapping/transcript.js';

export type OpenClawAdapterOptions = {
  protocols?: OpenClawProtocolCodec[];
  requestTimeoutMs?: number;
  connectTimeoutMs?: number;
  role?: string;
  scopes?: string[];
  clientName?: string;
  clientId?: string;
  clientVersion?: string;
  clientPlatform?: string;
  clientMode?: string;
  locale?: string;
  userAgent?: string;
  devicePairing?: 'disabled' | 'stored' | 'request';
};

type ConnectedState = {
  connection: RuntimeWebSocketConnection;
  codec: OpenClawProtocolCodec;
  hello: OpenClawHello;
  requestManager: OpenClawRequestManager;
  descriptorFingerprint?: string;
};

type StoredOpenClawDeviceIdentity = {
  deviceId: string;
  publicKeyDer: string;
  privateKeyDer: string;
};

export class OpenClawAdapter implements AgentRuntimeAdapter {
  readonly adapterId = 'openclaw';
  readonly adapterVersion = '0.1.0';

  private readonly registry = new OpenClawProtocolRegistry();
  private connected?: ConnectedState;
  private target?: RuntimeTarget;

  constructor(
    private readonly deps: RuntimeAdapterDependencies,
    private readonly options: OpenClawAdapterOptions = {},
  ) {
    for (const codec of options.protocols ?? [openClawV4Codec(), openClawV3Codec()]) {
      this.registry.register(codec);
    }
  }

  async probe(target: RuntimeTarget, options?: ProbeOptions): Promise<RuntimeProbeResult> {
    const started = this.deps.clock.now().getTime();
    const endpoint = toWebSocketEndpoint(target.endpoint);
    try {
      const connection = await withDeadline(
        this.deps.webSockets.connect({ url: endpoint, signal: options?.signal }),
        options?.timeoutMs ?? this.options.connectTimeoutMs ?? 5_000,
        options?.signal,
      );
      try {
        const challenge = await waitForChallenge(connection, this.registry.require(this.registry.preferredVersions()[0] ?? 4));
        return {
          matched: true,
          confidence: options?.allowAuthentication ? 0.8 : 0.75,
          adapterId: this.adapterId,
          runtimeProduct: 'openclaw',
          protocolName: 'openclaw-gateway',
          endpointFingerprint: await connectionFingerprint(this.deps.crypto, {
            adapterId: this.adapterId,
            endpoint: normalizeEndpoint(endpoint),
          }),
          evidence: challenge ? ['connect.challenge observed'] : ['websocket opened'],
          warnings: options?.allowAuthentication ? ['probe did not submit user prompt'] : [],
          durationMs: this.deps.clock.now().getTime() - started,
        };
      } finally {
        await connection.close().catch(() => undefined);
      }
    } catch (error) {
      return {
        matched: false,
        confidence: 0,
        adapterId: this.adapterId,
        evidence: [],
        warnings: [error instanceof Error ? error.message : String(error)],
        durationMs: this.deps.clock.now().getTime() - started,
      };
    }
  }

  async connect(config: RuntimeConnectionConfig, options?: ConnectOptions): Promise<RuntimeConnectionInfo> {
    if (this.connected && !options?.forceReconnect) {
      return {
        descriptor: this.descriptor(this.connected),
        connectedAt: this.deps.clock.now().toISOString(),
        connectionId: this.connected.hello.connectionId,
        warnings: [],
      };
    }

    await this.close();
    this.target = config.target;
    const endpoint = toWebSocketEndpoint(config.target.endpoint);
    const versions = protocolVersionsFromOptions(config.options) ?? this.registry.preferredVersions();
    const failures: RuntimeError[] = [];

    for (const version of versions) {
      const codec = this.registry.require(version);
      try {
        const state = await this.connectWithCodec(endpoint, codec, config, options);
        this.connected = state;
        return {
          descriptor: this.descriptor(state),
          connectedAt: this.deps.clock.now().toISOString(),
          connectionId: state.hello.connectionId,
          warnings: state.hello.protocolVersion !== version ? [`Gateway selected protocol ${state.hello.protocolVersion}`] : [],
        };
      } catch (error) {
        const mapped = codec.mapError(error);
        failures.push(mapped);
        if (mapped.code !== 'PROTOCOL_MISMATCH') throw mapped;
      }
    }

    throw new RuntimeError({
      code: 'PROTOCOL_MISMATCH',
      retryable: false,
      adapterId: this.adapterId,
      message: 'No supported OpenClaw protocol version connected',
      details: { attemptedVersions: versions, failures: failures.map((failure) => failure.message) },
    });
  }

  async health(): Promise<RuntimeHealth> {
    if (!this.connected) {
      return { status: 'unavailable', checkedAt: this.deps.clock.now().toISOString(), warnings: ['not connected'] };
    }
    return {
      status: 'healthy',
      checkedAt: this.deps.clock.now().toISOString(),
      descriptor: this.descriptor(this.connected),
      warnings: [],
      details: {
        runtimeProduct: 'openclaw',
        protocolVersion: this.connected.codec.protocolVersion,
        methodAvailability: {
          sessionsCreate: this.connected.codec.supportsMethod('sessions.create', this.connected.hello),
          chatSend: this.connected.codec.supportsMethod('chat.send', this.connected.hello),
          agentWait: this.connected.codec.supportsMethod('agent.wait', this.connected.hello),
          chatHistory: this.connected.codec.supportsMethod('chat.history', this.connected.hello),
          chatAbort: this.connected.codec.supportsMethod('chat.abort', this.connected.hello),
        },
      },
    };
  }

  async capabilities(): Promise<RuntimeCapabilities> {
    return this.connected?.codec.capabilities(this.connected.hello) ?? this.registry.require(this.registry.preferredVersions()[0] ?? 4).capabilities();
  }

  async ensureSession(input: EnsureSessionInput, options?: OperationOptions): Promise<RuntimeSession> {
    const state = this.requireConnected();
    const externalSessionId =
      typeof input.providerState?.externalSessionId === 'string'
        ? input.providerState.externalSessionId
        : input.applicationSessionId;
    if (state.codec.supportsMethod('sessions.create', state.hello)) {
      await state.requestManager.request(state.codec.buildSessionCreate({ ...input, applicationSessionId: externalSessionId }), options?.signal);
    }
    return {
      applicationSessionId: input.applicationSessionId,
      externalSessionId,
      providerState: {
        adapterId: this.adapterId,
        protocolVersion: state.codec.protocolVersion,
      },
      created: true,
    };
  }

  async startRun(input: StartRuntimeRunInput, options?: OperationOptions): Promise<RuntimeRunHandle> {
    assertStartRunInput(input);
    const capabilities = await this.capabilities();
    validateInputCapabilities(capabilities, input.input);
    const state = this.requireConnected();
    const response = await state.requestManager.request<Record<string, unknown>>(state.codec.buildRunStart(input), options?.signal);
    const externalRunId = stringValue(response.runId) ?? stringValue(response.id) ?? input.applicationRunId;
    return {
      applicationRunId: input.applicationRunId,
      externalRunId,
      status: normalizeStatus(response.status),
      providerState: { adapterId: this.adapterId, protocolVersion: state.codec.protocolVersion, method: 'chat.send', response },
    };
  }

  async *streamRun(input: StreamRuntimeRunInput): AsyncIterable<RuntimeEvent> {
    const state = this.requireConnected();
    for await (const event of state.connection.events()) {
      if (event.type !== 'message') continue;
      const frame = state.codec.parseFrame(event.data);
      if (frame.type === 'event') {
        yield* state.codec.mapProviderEvent(frame, input);
      }
    }
  }

  async getRun(input: GetRuntimeRunInput, options?: OperationOptions): Promise<RuntimeRunSnapshot> {
    const state = this.requireConnected();
    if (!state.codec.supportsMethod('agent.wait', state.hello)) {
      return { applicationRunId: input.applicationRunId, externalRunId: input.externalRunId, status: 'unknown' };
    }
    const response = await state.requestManager.request<Record<string, unknown>>(state.codec.buildRunWait(input), options?.signal);
    return {
      applicationRunId: input.applicationRunId,
      externalRunId: input.externalRunId,
      status: normalizeStatus(response.status),
      output: stringValue(response.output ?? response.text ?? response.message),
      usage: typeof response.usage === 'object' && response.usage ? (response.usage as Record<string, number>) : undefined,
      providerState: response,
    };
  }

  async cancelRun(input: CancelRuntimeRunInput, options?: OperationOptions): Promise<void> {
    const state = this.requireConnected();
    if (!state.codec.supportsMethod('chat.abort', state.hello) && !state.codec.supportsMethod('sessions.abort', state.hello)) return;
    await state.requestManager.request(state.codec.buildCancel(input), options?.signal);
  }

  async getHistory(input: GetRuntimeHistoryInput, options?: OperationOptions): Promise<RuntimeMessage[]> {
    const state = this.requireConnected();
    const payload = await state.requestManager.request(state.codec.buildHistory(input), options?.signal);
    return normalizeOpenClawHistory(payload);
  }

  async close(): Promise<void> {
    const connection = this.connected?.connection;
    this.connected = undefined;
    await connection?.close().catch(() => undefined);
  }

  private async connectWithCodec(
    endpoint: string,
    codec: OpenClawProtocolCodec,
    config: RuntimeConnectionConfig,
    options?: ConnectOptions,
  ): Promise<ConnectedState> {
    const connection = await withDeadline(
      this.deps.webSockets.connect({ url: endpoint, signal: options?.signal }),
      options?.timeoutMs ?? this.options.connectTimeoutMs ?? 15_000,
      options?.signal,
    );
    try {
      const challenge = await waitForChallenge(connection, codec);
      const scopes = this.options.scopes ?? ['operator.read', 'operator.write'];
      const identity = challenge && config.auth && config.auth.kind !== 'none'
        ? await this.resolveDeviceIdentity(endpoint)
        : undefined;
      const deviceToken = identity
        ? await this.getStoredDeviceToken(endpoint, identity.deviceId, this.options.role ?? 'operator')
        : undefined;
      const device =
        challenge && config.auth && identity
          ? await this.buildSignedDeviceProof(identity, config.auth, challenge, scopes)
          : undefined;
      const params = codec.createConnectParams({
        requestId: 'connect-1',
        nonce: challenge,
        auth: config.auth,
        role: this.options.role,
        scopes,
        clientName: this.options.clientName,
        clientId: this.options.clientId,
        clientVersion: this.options.clientVersion,
        clientPlatform: this.options.clientPlatform,
        clientMode: this.options.clientMode,
        locale: this.options.locale,
        userAgent: this.options.userAgent,
        deviceToken,
        device,
      });
      const requestManager = new OpenClawRequestManager(connection, codec, this.options.requestTimeoutMs ?? 30_000);
      const helloPayload = await requestManager.request<Record<string, unknown>>(
        { id: 'connect-1', method: 'connect', params },
        options?.signal,
      );
      const hello = codec.parseHello(helloPayload);
      if (identity) await this.saveReturnedDeviceToken(endpoint, identity.deviceId, this.options.role ?? 'operator', hello);
      if (hello.protocolVersion !== codec.protocolVersion) {
        throw new RuntimeError({
          code: 'PROTOCOL_MISMATCH',
          retryable: false,
          adapterId: this.adapterId,
          message: `OpenClaw selected protocol ${hello.protocolVersion}, expected ${codec.protocolVersion}`,
          details: { selectedProtocol: hello.protocolVersion, attemptedProtocol: codec.protocolVersion },
        });
      }
      return {
        connection,
        codec,
        hello,
        requestManager,
        descriptorFingerprint: await connectionFingerprint(this.deps.crypto, {
          adapterId: this.adapterId,
          endpoint: normalizeEndpoint(endpoint),
          protocol: codec.protocolVersion,
          credentialRef: config.credentialRef,
          options: config.options,
        }),
      };
    } catch (error) {
      await connection.close().catch(() => undefined);
      throw error;
    }
  }

  private descriptor(state: ConnectedState) {
    return {
      schemaVersion: 1 as const,
      adapterId: this.adapterId,
      adapterVersion: this.adapterVersion,
      runtimeProduct: 'openclaw',
      runtimeVersion: state.hello.runtimeVersion,
      protocolName: state.codec.protocolName,
      protocolVersion: String(state.codec.protocolVersion),
      endpointFingerprint: state.descriptorFingerprint,
      capabilities: state.codec.capabilities(state.hello),
    };
  }

  private requireConnected(): ConnectedState {
    if (!this.connected) {
      throw new RuntimeError({
        code: 'INVALID_CONFIGURATION',
        retryable: false,
        adapterId: this.adapterId,
        message: 'OpenClaw adapter is not connected',
      });
    }
    return this.connected;
  }

  private async buildSignedDeviceProof(
    identity: StoredOpenClawDeviceIdentity,
    auth: NonNullable<RuntimeConnectionConfig['auth']>,
    nonce: string,
    scopes: string[],
  ) {
    const signedAt = this.deps.clock.now().getTime();
    const token = auth.kind === 'token' || auth.kind === 'bearer' || auth.kind === 'device-token' ? auth.token : undefined;
    const payload = [
      'v2',
      identity.deviceId,
      this.options.clientId ?? this.options.clientName ?? 'gateway-client',
      this.options.clientMode ?? 'backend',
      this.options.role ?? 'operator',
      scopes.join(','),
      String(signedAt),
      token ?? '',
      nonce,
    ].join('|');
    const signature = await this.deps.crypto.signEd25519(base64UrlDecode(identity.privateKeyDer), new TextEncoder().encode(payload));
    return {
      id: identity.deviceId,
      publicKey: publicKeyRawBase64Url(base64UrlDecode(identity.publicKeyDer)),
      signature: base64UrlEncode(signature),
      signedAt,
      nonce,
    };
  }

  private async getOrCreateDeviceIdentity(endpoint: string): Promise<StoredOpenClawDeviceIdentity> {
    const key = await connectionFingerprint(this.deps.crypto, {
      adapterId: this.adapterId,
      purpose: 'openclaw-device-identity',
      endpoint: normalizeEndpoint(endpoint),
    });
    const existing = await this.getStoredDeviceIdentity(endpoint);
    if (existing?.deviceId && existing.publicKeyDer && existing.privateKeyDer) return existing;
    const generated = await this.deps.crypto.generateEd25519KeyPair();
    const rawPublicKey = publicKeyRawBytes(generated.publicKey);
    const digest = await this.deps.crypto.sha256(rawPublicKey);
    const identity: StoredOpenClawDeviceIdentity = {
      deviceId: hexEncode(digest),
      publicKeyDer: base64UrlEncode(generated.publicKey),
      privateKeyDer: base64UrlEncode(generated.privateKey),
    };
    await this.deps.state.set('openclaw.device', key, identity);
    return identity;
  }

  private async getStoredDeviceIdentity(endpoint: string): Promise<StoredOpenClawDeviceIdentity | undefined> {
    const key = await connectionFingerprint(this.deps.crypto, {
      adapterId: this.adapterId,
      purpose: 'openclaw-device-identity',
      endpoint: normalizeEndpoint(endpoint),
    });
    const existing = await this.deps.state.get<StoredOpenClawDeviceIdentity>('openclaw.device', key);
    return existing?.deviceId && existing.publicKeyDer && existing.privateKeyDer ? existing : undefined;
  }

  private async resolveDeviceIdentity(endpoint: string): Promise<StoredOpenClawDeviceIdentity | undefined> {
    const mode = this.options.devicePairing ?? 'stored';
    if (mode === 'disabled') return undefined;
    if (mode === 'request') return this.getOrCreateDeviceIdentity(endpoint);

    const existing = await this.getStoredDeviceIdentity(endpoint);
    if (!existing) return undefined;
    const deviceToken = await this.getStoredDeviceToken(endpoint, existing.deviceId, this.options.role ?? 'operator');
    return deviceToken ? existing : undefined;
  }

  private async getStoredDeviceToken(endpoint: string, deviceId: string, role: string): Promise<string | undefined> {
    const key = await this.deviceTokenStateKey(endpoint, deviceId, role);
    const record = await this.deps.state.get<{ token?: string }>('openclaw.device-token', key);
    return typeof record?.token === 'string' && record.token ? record.token : undefined;
  }

  private async saveReturnedDeviceToken(endpoint: string, deviceId: string, role: string, hello: OpenClawHello): Promise<void> {
    const raw = hello.raw && typeof hello.raw === 'object' ? (hello.raw as Record<string, unknown>) : {};
    const auth = raw.auth && typeof raw.auth === 'object' ? (raw.auth as Record<string, unknown>) : {};
    const deviceToken = auth.deviceToken;
    if (typeof deviceToken !== 'string' || !deviceToken) return;
    const key = await this.deviceTokenStateKey(endpoint, deviceId, role);
    await this.deps.state.set('openclaw.device-token', key, {
      token: deviceToken,
      role,
      deviceId,
      updatedAt: this.deps.clock.now().toISOString(),
    });
  }

  private async deviceTokenStateKey(endpoint: string, deviceId: string, role: string): Promise<string> {
    return connectionFingerprint(this.deps.crypto, {
      adapterId: this.adapterId,
      purpose: 'openclaw-device-token',
      endpoint: normalizeEndpoint(endpoint),
      deviceId,
      role,
    });
  }
}

export function createOpenClawAdapterFactory(options?: OpenClawAdapterOptions) {
  return {
    adapterId: 'openclaw',
    create: (dependencies: RuntimeAdapterDependencies) => new OpenClawAdapter(dependencies, options),
  };
}

async function waitForChallenge(
  connection: RuntimeWebSocketConnection,
  codec: OpenClawProtocolCodec,
): Promise<string | undefined> {
  for await (const event of connection.events()) {
    if (event.type === 'open') continue;
    if (event.type === 'message') {
      const frame = codec.parseFrame(event.data);
      if (frame.type === 'event' && frame.event === 'connect.challenge') {
        const payload = frame.payload as Record<string, unknown> | undefined;
        return typeof payload?.nonce === 'string' ? payload.nonce : undefined;
      }
      if (frame.type === 'hello-ok' || frame.type === 'res') return undefined;
    }
    if (event.type === 'close') {
      throw new RuntimeError({
        code: 'NETWORK',
        retryable: true,
        adapterId: 'openclaw',
        message: 'OpenClaw socket closed before challenge',
      });
    }
  }
  return undefined;
}

function toWebSocketEndpoint(endpoint: string): string {
  return endpoint
    .replace(/^openclaw\+ws:/, 'ws:')
    .replace(/^openclaw\+wss:/, 'wss:')
    .replace(/^https:/, 'wss:')
    .replace(/^http:/, 'ws:');
}

function protocolVersionsFromOptions(options?: Readonly<Record<string, unknown>>): number[] | undefined {
  const value = options?.protocolVersion ?? options?.protocolVersions;
  if (typeof value === 'number') return [value];
  if (Array.isArray(value)) return value.filter((item): item is number => typeof item === 'number');
  return undefined;
}

function normalizeStatus(status: unknown) {
  if (status === 'queued' || status === 'running' || status === 'waiting_for_approval' || status === 'stopping') return status;
  if (status === 'completed' || status === 'failed' || status === 'cancelled') return status;
  return 'unknown';
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

const ED25519_SPKI_PREFIX = Uint8Array.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]);

function publicKeyRawBytes(publicKeyDer: Uint8Array): Uint8Array {
  if (publicKeyDer.length === ED25519_SPKI_PREFIX.length + 32) {
    const prefixMatches = ED25519_SPKI_PREFIX.every((byte, index) => publicKeyDer[index] === byte);
    if (prefixMatches) return publicKeyDer.slice(ED25519_SPKI_PREFIX.length);
  }
  return publicKeyDer;
}

function publicKeyRawBase64Url(publicKeyDer: Uint8Array): string {
  return base64UrlEncode(publicKeyRawBytes(publicKeyDer));
}

function base64UrlEncode(value: Uint8Array): string {
  let output = '';
  for (let index = 0; index < value.length; index += 3) {
    const first = value[index] ?? 0;
    const second = value[index + 1] ?? 0;
    const third = value[index + 2] ?? 0;
    const combined = (first << 16) | (second << 8) | third;
    output += BASE64URL_ALPHABET[(combined >> 18) & 63];
    output += BASE64URL_ALPHABET[(combined >> 12) & 63];
    output += index + 1 < value.length ? BASE64URL_ALPHABET[(combined >> 6) & 63] : '';
    output += index + 2 < value.length ? BASE64URL_ALPHABET[combined & 63] : '';
  }
  return output;
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = `${normalized}${'='.repeat((4 - (normalized.length % 4)) % 4)}`;
  const nodeBuffer = (globalThis as { Buffer?: { from(value: string, encoding: 'base64'): { toString(encoding: 'binary'): string } } }).Buffer;
  const binary =
    typeof atob === 'function'
      ? atob(padded)
      : nodeBuffer
        ? nodeBuffer.from(padded, 'base64').toString('binary')
        : undefined;
  if (binary === undefined) {
    throw new RuntimeError({
      code: 'INVALID_CONFIGURATION',
      retryable: false,
      adapterId: 'openclaw',
      message: 'No base64 decoder is available in this runtime',
    });
  }
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function hexEncode(value: Uint8Array): string {
  return [...value].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
