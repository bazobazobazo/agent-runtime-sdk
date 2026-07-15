import {
  RuntimeError,
  NO_CAPABILITIES,
  isTerminalEvent,
  type AgentRuntimeAdapter,
  type CancelRuntimeRunInput,
  type ConnectOptions,
  type EnsureSessionInput,
  type GetRuntimeHistoryInput,
  type GetRuntimeRunInput,
  type OperationOptions,
  type ProbeOptions,
  type RuntimeAdapterDependencies,
  type RuntimeAdapterLifecycleState,
  type RuntimeCapabilities,
  type RuntimeConnectionConfig,
  type RuntimeConnectionInfo,
  type RuntimeEvent,
  type RuntimeHealth,
  type RuntimeHistoryPage,
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
import {
  assertStartRunInput,
  connectionFingerprint,
  normalizeEndpoint,
  runtimeEventBase,
  validateInputCapabilities,
  withDeadline,
} from '@banzae/agent-runtime-core/experimental';
import { OpenClawRequestManager } from './transport/request-manager.js';
import { OpenClawProtocolRegistry } from './protocol/registry.js';
import { classifyNegotiationFailure } from './protocol/negotiation.js';
import { openClawV3Codec } from './protocol/v3/codec.js';
import { openClawV4Codec } from './protocol/v4/codec.js';
import type { OpenClawFrame, OpenClawHello, OpenClawProtocolCodec } from './protocol/types.js';
import { normalizeOpenClawHistory } from './mapping/transcript.js';

/** Public alpha contract for open claw adapter options. */
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
  maxFrameBytes?: number;
  subscriberQueueSize?: number;
  includeRawProviderPayload?: boolean;
};

type ConnectedState = {
  connection: RuntimeWebSocketConnection;
  codec: OpenClawProtocolCodec;
  hello: OpenClawHello;
  dispatcher: OpenClawRequestManager;
  descriptorFingerprint?: string;
};

type StoredOpenClawDeviceIdentity = {
  deviceId: string;
  publicKeyDer: string;
  privateKeyDer: string;
};

/** Public alpha contract for open claw adapter. */
export class OpenClawAdapter implements AgentRuntimeAdapter {
  readonly adapterId = 'openclaw';
  readonly adapterVersion = '0.1.0';
  private state: RuntimeAdapterLifecycleState = 'created';

  get lifecycleState(): RuntimeAdapterLifecycleState {
    return this.state;
  }

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
        warnings: [error instanceof RuntimeError ? `${error.code}: OpenClaw probe failed` : 'OpenClaw probe failed'],
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
    this.state = 'connecting';
    this.target = config.target;
    let resolvedConfig: RuntimeConnectionConfig;
    try {
      resolvedConfig = await resolveOpenClawConnectionConfig(this.deps, config);
    } catch (error) {
      this.state = 'closed';
      throw error;
    }
    const endpoint = toWebSocketEndpoint(config.target.endpoint);
    const versions = protocolVersionsFromOptions(config.options) ?? this.registry.preferredVersions();
    const failures: RuntimeError[] = [];

    for (const version of versions) {
      const codec = this.registry.require(version);
      try {
        const state = await this.connectWithCodec(endpoint, codec, resolvedConfig, options);
        this.connected = state;
        this.state = 'connected';
        return {
          descriptor: this.descriptor(state),
          connectedAt: this.deps.clock.now().toISOString(),
          connectionId: state.hello.connectionId,
          warnings: state.hello.protocolVersion !== version ? [`Gateway selected protocol ${state.hello.protocolVersion}`] : [],
        };
      } catch (error) {
        const mapped = codec.mapError(error);
        failures.push(mapped);
        if (classifyNegotiationFailure(mapped) !== 'try-next-protocol') {
          this.state = 'closed';
          throw mapped;
        }
      }
    }

    this.state = 'closed';
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
      checks: [
        { name: 'gateway', kind: 'transport', status: 'healthy' },
        { name: 'liveness', kind: 'liveness', status: 'healthy' },
      ],
    };
  }

  async capabilities(): Promise<RuntimeCapabilities> {
    return this.connected?.codec.capabilities(this.connected.hello) ?? NO_CAPABILITIES;
  }

  async ensureSession(input: EnsureSessionInput, options?: OperationOptions): Promise<RuntimeSession> {
    const state = this.requireConnected();
    const capabilities = state.codec.capabilities(state.hello);
    if (!capabilities.sessions.create && !capabilities.sessions.resume) throw unsupported('OpenClaw sessions are unavailable');
    const externalSessionId =
      typeof input.providerState?.externalSessionId === 'string'
        ? input.providerState.externalSessionId
        : input.applicationSessionId;
    const createsProviderSession = state.codec.supportsMethod('sessions.create', state.hello);
    if (createsProviderSession) {
      await state.dispatcher.request(state.codec.buildSessionCreate({ ...input, applicationSessionId: externalSessionId }), {
        signal: options?.signal,
      });
    }
    return {
      applicationSessionId: input.applicationSessionId,
      externalSessionId,
      providerState: {
        adapterId: this.adapterId,
        protocolVersion: state.codec.protocolVersion,
      },
      created: createsProviderSession,
    };
  }

  async startRun(input: StartRuntimeRunInput, options?: OperationOptions): Promise<RuntimeRunHandle> {
    assertStartRunInput(input);
    const capabilities = await this.capabilities();
    if (!capabilities.runs.start) throw unsupported('OpenClaw run start is unavailable');
    validateInputCapabilities(capabilities, input.input);
    const state = this.requireConnected();
    let response: Record<string, unknown>;
    try {
      response = await state.dispatcher.request<Record<string, unknown>>(state.codec.buildRunStart(input), {
        signal: options?.signal,
      });
    } catch (error) {
      throw this.mapRunStartTransportError(error);
    }
    const parsed = state.codec.parseRunStartResponse(response);
    return {
      applicationRunId: input.applicationRunId,
      externalRunId: parsed.externalRunId,
      status: parsed.status,
      providerState: parsed.providerState,
    };
  }

  streamRun(input: StreamRuntimeRunInput): AsyncIterable<RuntimeEvent> {
    const state = this.requireConnected();
    if (!state.codec.capabilities(state.hello).runs.stream) throw unsupported('OpenClaw run streaming is unavailable');
    return new OpenClawRunEventStream(state, this.deps, input, this.options.includeRawProviderPayload ?? false);
  }

  async getRun(input: GetRuntimeRunInput, options?: OperationOptions): Promise<RuntimeRunSnapshot> {
    const state = this.requireConnected();
    if (!state.codec.capabilities(state.hello).runs.status) throw unsupported('OpenClaw run status is unavailable');
    const response = await state.dispatcher.request<Record<string, unknown>>(state.codec.buildRunWait(input), {
      signal: options?.signal,
    });
    return state.codec.parseRunWaitResponse(input, response);
  }

  async cancelRun(input: CancelRuntimeRunInput, options?: OperationOptions): Promise<void> {
    const state = this.requireConnected();
    if (!state.codec.capabilities(state.hello).runs.cancel) throw unsupported('OpenClaw run cancellation is unavailable');
    const response = await state.dispatcher.request(state.codec.buildCancel(input), { signal: options?.signal });
    state.codec.parseCancelResponse(response);
  }

  async getHistory(input: GetRuntimeHistoryInput, options?: OperationOptions): Promise<RuntimeHistoryPage> {
    const state = this.requireConnected();
    if (!state.codec.capabilities(state.hello).sessions.history) throw unsupported('OpenClaw session history is unavailable');
    const payload = await state.dispatcher.request(state.codec.buildHistory(input), { signal: options?.signal });
    return { messages: normalizeOpenClawHistory(payload) };
  }

  async close(): Promise<void> {
    if (this.state === 'closing') return;
    this.state = 'closing';
    const dispatcher = this.connected?.dispatcher;
    const connection = this.connected?.connection;
    this.connected = undefined;
    await dispatcher?.close().catch(() => undefined);
    await connection?.close().catch(() => undefined);
    this.state = 'closed';
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
      const challenge = await withDeadline(
        waitForChallenge(connection, codec),
        options?.timeoutMs ?? this.options.connectTimeoutMs ?? 15_000,
        options?.signal,
      );
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
      const dispatcher = new OpenClawRequestManager(connection, codec, {
        requestTimeoutMs: this.options.requestTimeoutMs ?? 30_000,
        maxFrameBytes: this.options.maxFrameBytes,
        subscriberQueueSize: this.options.subscriberQueueSize,
      });
      const helloPayload = await dispatcher.request<Record<string, unknown>>(
        { id: 'connect-1', method: 'connect', params },
        { signal: options?.signal },
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
        dispatcher,
        descriptorFingerprint: await connectionFingerprint(this.deps.crypto, {
          adapterId: this.adapterId,
          endpoint: normalizeEndpoint(endpoint),
          protocol: codec.protocolVersion,
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
      observedAt: this.deps.clock.now().toISOString(),
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

  private mapRunStartTransportError(error: unknown): RuntimeError {
    if (error instanceof RuntimeError) {
      if (error.code === 'NETWORK' || error.code === 'TIMEOUT') {
        return new RuntimeError({
          code: 'OUTCOME_UNKNOWN',
          retryable: true,
          adapterId: this.adapterId,
          message: 'OpenClaw run start outcome is unknown',
          details: { originalCode: error.code },
          cause: error,
        });
      }
      return error;
    }
    return new RuntimeError({
      code: 'OUTCOME_UNKNOWN',
      retryable: true,
      adapterId: this.adapterId,
      message: 'OpenClaw run start outcome is unknown',
      cause: error,
    });
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

/** Public alpha contract for create open claw adapter factory. */
export function createOpenClawAdapterFactory(options?: OpenClawAdapterOptions) {
  return {
    adapterId: 'openclaw',
    create: (dependencies: RuntimeAdapterDependencies) => new OpenClawAdapter(dependencies, options),
  };
}

async function resolveOpenClawConnectionConfig(
  dependencies: RuntimeAdapterDependencies,
  config: RuntimeConnectionConfig,
): Promise<RuntimeConnectionConfig> {
  if (config.auth || !config.credentialRef) return config;
  const secret = await dependencies.secrets.get(config.credentialRef);
  if (!secret) {
    throw new RuntimeError({
      code: 'AUTHENTICATION_REQUIRED',
      retryable: false,
      adapterId: 'openclaw',
      message: 'OpenClaw credential reference could not be resolved',
      operation: 'connect',
    });
  }
  const token = typeof secret.value === 'string'
    ? secret.value
    : new TextDecoder().decode(secret.value);
  return { ...config, auth: { kind: 'token', token } };
}

class OpenClawRunEventStream implements AsyncIterableIterator<RuntimeEvent> {
  private readonly iterator: AsyncIterator<Extract<OpenClawFrame, { type: 'event' }>>;
  private readonly stream: OpenClawRunStreamState;
  private readonly buffer: RuntimeEvent[] = [];
  private done = false;

  constructor(
    private readonly state: ConnectedState,
    private readonly deps: RuntimeAdapterDependencies,
    private readonly input: StreamRuntimeRunInput,
    private readonly includeRawProviderPayload: boolean,
  ) {
    this.iterator = state.dispatcher.subscribe()[Symbol.asyncIterator]();
    this.stream = new OpenClawRunStreamState(deps, input);
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<RuntimeEvent> {
    return this;
  }

  async next(): Promise<IteratorResult<RuntimeEvent>> {
    while (this.buffer.length === 0 && !this.done) {
      const next = await this.iterator.next();
      if (next.done) {
        this.done = true;
        this.stream.close();
        break;
      }
      await this.acceptFrame(next.value);
    }

    const value = this.buffer.shift();
    return value ? { value, done: false } : { value: undefined, done: true };
  }

  async return(): Promise<IteratorResult<RuntimeEvent>> {
    await this.close();
    return { value: undefined, done: true };
  }

  async throw(error?: unknown): Promise<IteratorResult<RuntimeEvent>> {
    await this.close();
    throw error;
  }

  private async acceptFrame(frame: Extract<OpenClawFrame, { type: 'event' }>): Promise<void> {
    const mapped = this.state.codec.mapProviderEvent(frame, {
      ...this.input,
      clock: this.deps.clock,
      ids: this.deps.ids,
      includeRawProviderPayload: this.includeRawProviderPayload,
    });
    if (mapped.length === 0) return;

    const metadata = this.state.codec.extractProviderEventMetadata(frame);
    const gap = this.stream.acceptSequence(metadata.sequence);
    if (gap) this.buffer.push(gap);

    for (const event of mapped) {
      if (!this.stream.acceptEvent(event)) continue;
      this.buffer.push(event);
      if (isTerminalEvent(event)) {
        await this.close();
        return;
      }
    }
  }

  private async close(): Promise<void> {
    if (this.done) return;
    this.done = true;
    this.stream.close();
    await this.iterator.return?.();
  }
}

class OpenClawRunStreamState {
  private readonly seenEventIds: string[] = [];
  private readonly seenEventIdSet = new Set<string>();
  private lastSequence?: number;
  private terminal = false;

  constructor(
    private readonly deps: RuntimeAdapterDependencies,
    private readonly input: StreamRuntimeRunInput,
    private readonly maxSeenEvents = 512,
  ) {}

  acceptSequence(sequence?: number): RuntimeEvent | undefined {
    if (sequence == null) return undefined;
    if (this.lastSequence != null && sequence <= this.lastSequence) return undefined;
    const expected = this.lastSequence == null ? sequence : this.lastSequence + 1;
    const hasGap = this.lastSequence != null && sequence !== expected;
    this.lastSequence = sequence;
    if (!hasGap) return undefined;
    return {
      ...runtimeEventBase({
        ids: { id: () => `${this.input.externalRunId}:gap:${expected}:${sequence}` },
        now: this.deps.clock.now(),
        type: 'transport.gap',
        applicationRunId: this.input.applicationRunId,
        externalRunId: this.input.externalRunId,
        externalSessionId: this.input.externalSessionId,
        sequence,
        provider: { adapterId: 'openclaw', eventName: 'sequence.gap' },
      }),
      type: 'transport.gap',
      expected,
      actual: sequence,
    };
  }

  acceptEvent(event: RuntimeEvent): boolean {
    if (this.terminal && isTerminalEvent(event)) return false;
    if (this.seenEventIdSet.has(event.eventId)) return false;
    this.seenEventIdSet.add(event.eventId);
    this.seenEventIds.push(event.eventId);
    if (this.seenEventIds.length > this.maxSeenEvents) {
      const oldest = this.seenEventIds.shift();
      if (oldest) this.seenEventIdSet.delete(oldest);
    }
    if (isTerminalEvent(event)) this.terminal = true;
    return true;
  }

  close(): void {
    this.terminal = true;
    this.seenEventIds.length = 0;
    this.seenEventIdSet.clear();
  }
}

async function waitForChallenge(
  connection: RuntimeWebSocketConnection,
  codec: OpenClawProtocolCodec,
): Promise<string | undefined> {
  for await (const event of connection.events()) {
    if (event.type === 'open') continue;
    if (event.type === 'message') {
      const frame = codec.parseFrame(event.data);
      const challenge = codec.parseChallenge(frame);
      if (challenge) return challenge.nonce;
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

function unsupported(message: string): RuntimeError {
  return new RuntimeError({ code: 'UNSUPPORTED_CAPABILITY', retryable: false, adapterId: 'openclaw', message });
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
