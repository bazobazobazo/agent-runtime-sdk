import {
  RuntimeError,
  assertStartRunInput,
  connectionFingerprint,
  normalizeEndpoint,
  validateInputCapabilities,
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
} from '@banzae/agent-runtime-core';
import { HermesHttpClient } from './http/client.js';
import { isHermesCapabilities, mapHermesCapabilities } from './mapping/capabilities.js';
import { mapHermesSseEvent, parseHermesEventData } from './mapping/events.js';
import { parseSseStream } from './sse/parser.js';

export type HermesAdapterOptions = {
  baseUrl?: string;
  bearerToken?: string;
  bearerTokenRef?: string;
  model?: string;
  requestTimeoutMs?: number;
  runTimeoutMs?: number;
  sessionKeyHeader?: string;
  historyMode?: 'previous_response_id' | 'conversation_history' | 'hybrid';
};

type ConnectedHermes = {
  client: HermesHttpClient;
  capabilitiesPayload: unknown;
  capabilities: RuntimeCapabilities;
  descriptorFingerprint?: string;
};

export class HermesAdapter implements AgentRuntimeAdapter {
  readonly adapterId = 'hermes';
  readonly adapterVersion = '0.1.0';

  private connected?: ConnectedHermes;

  constructor(
    private readonly deps: RuntimeAdapterDependencies,
    private readonly options: HermesAdapterOptions = {},
  ) {}

  async probe(target: RuntimeTarget, options?: ProbeOptions): Promise<RuntimeProbeResult> {
    const started = this.deps.clock.now().getTime();
    const client = new HermesHttpClient(this.deps.http, {
      baseUrl: toHttpBase(target.endpoint),
      bearerToken: options?.allowAuthentication ? this.options.bearerToken : authToken(target.authHint, undefined),
      requestTimeoutMs: options?.timeoutMs,
    });
    try {
      const response = await client.json<unknown>('GET', '/v1/capabilities', { signal: options?.signal });
      if (!isHermesCapabilities(response.value)) {
        return {
          matched: false,
          confidence: 0.2,
          adapterId: this.adapterId,
          evidence: ['capabilities endpoint returned non-Hermes shape'],
          warnings: [],
          durationMs: this.deps.clock.now().getTime() - started,
        };
      }
      const endpointFingerprint = await connectionFingerprint(this.deps.crypto, {
        adapterId: this.adapterId,
        endpoint: normalizeEndpoint(toHttpBase(target.endpoint)),
      });
      return {
        matched: true,
        confidence: 1,
        adapterId: this.adapterId,
        runtimeProduct: 'hermes-agent',
        runtimeVersion: stringValue((response.value as Record<string, unknown>).version),
        protocolName: 'hermes-runs-http',
        protocolVersion: '1',
        endpointFingerprint,
        capabilities: mapHermesCapabilities(response.value),
        evidence: ['/v1/capabilities identified hermes-agent'],
        warnings: [],
        durationMs: this.deps.clock.now().getTime() - started,
      };
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

  async connect(config: RuntimeConnectionConfig, _options?: ConnectOptions): Promise<RuntimeConnectionInfo> {
    const token = await resolveBearerToken(this.deps, config, this.options);
    const client = new HermesHttpClient(this.deps.http, {
      baseUrl: this.options.baseUrl ?? toHttpBase(config.target.endpoint),
      bearerToken: token,
      requestTimeoutMs: this.options.requestTimeoutMs,
    });
    const capabilitiesPayload = (await client.json<unknown>('GET', '/v1/capabilities')).value;
    if (!isHermesCapabilities(capabilitiesPayload)) {
      throw new RuntimeError({
        code: 'DETECTION_FAILED',
        retryable: false,
        adapterId: this.adapterId,
        message: 'Hermes capabilities endpoint did not return a Hermes capability object',
      });
    }
    const capabilities = mapHermesCapabilities(capabilitiesPayload);
    this.connected = {
      client,
      capabilitiesPayload,
      capabilities,
      descriptorFingerprint: await connectionFingerprint(this.deps.crypto, {
        adapterId: this.adapterId,
        endpoint: normalizeEndpoint(this.options.baseUrl ?? toHttpBase(config.target.endpoint)),
        credentialRef: config.credentialRef ?? this.options.bearerTokenRef,
      }),
    };
    return {
      descriptor: this.descriptor(this.connected),
      connectedAt: this.deps.clock.now().toISOString(),
      warnings: [],
    };
  }

  async health(): Promise<RuntimeHealth> {
    if (!this.connected) {
      return { status: 'unavailable', checkedAt: this.deps.clock.now().toISOString(), warnings: ['not connected'] };
    }
    try {
      const health = await this.connected.client.json<Record<string, unknown>>('GET', '/health/detailed');
      return {
        status: health.value.status === 'ok' || health.value.status === 'healthy' ? 'healthy' : 'degraded',
        checkedAt: this.deps.clock.now().toISOString(),
        descriptor: this.descriptor(this.connected),
        warnings: [],
        details: { status: health.value.status },
      };
    } catch {
      return {
        status: 'degraded',
        checkedAt: this.deps.clock.now().toISOString(),
        descriptor: this.descriptor(this.connected),
        warnings: ['detailed health unavailable'],
      };
    }
  }

  async capabilities(): Promise<RuntimeCapabilities> {
    return this.requireConnected().capabilities;
  }

  async ensureSession(input: EnsureSessionInput): Promise<RuntimeSession> {
    return {
      applicationSessionId: input.applicationSessionId,
      externalSessionId: typeof input.providerState?.sessionId === 'string' ? input.providerState.sessionId : input.applicationSessionId,
      providerState: {
        ...(input.providerState ?? {}),
        sessionId: typeof input.providerState?.sessionId === 'string' ? input.providerState.sessionId : input.applicationSessionId,
      },
      created: !input.providerState?.sessionId,
    };
  }

  async startRun(input: StartRuntimeRunInput, options?: OperationOptions): Promise<RuntimeRunHandle> {
    assertStartRunInput(input);
    const connected = this.requireConnected();
    validateInputCapabilities(connected.capabilities, input.input);
    const body = buildRunBody(input, this.options);
    const response = await connected.client.json<Record<string, unknown>>('POST', '/v1/runs', {
      body,
      idempotencyKey: input.idempotencyKey,
      signal: options?.signal,
      headers: sessionHeader(input.session.externalSessionId, this.options),
    });
    const externalRunId = stringValue(response.value.run_id ?? response.value.id);
    if (!externalRunId) {
      throw new RuntimeError({
        code: 'PROVIDER_ERROR',
        retryable: false,
        adapterId: this.adapterId,
        message: 'Hermes run creation did not return a run id',
      });
    }
    return {
      applicationRunId: input.applicationRunId,
      externalRunId,
      status: normalizeStatus(response.value.status),
      providerState: {
        previousResponseId: response.value.response_id,
        idempotencyTransport: 'provider',
      },
    };
  }

  async *streamRun(input: StreamRuntimeRunInput, options?: OperationOptions): AsyncIterable<RuntimeEvent> {
    const connected = this.requireConnected();
    const stream = await connected.client.stream(`/v1/runs/${encodeURIComponent(input.externalRunId)}/events`, {
      signal: options?.signal,
    });
    for await (const event of parseSseStream(stream)) {
      const data = parseHermesEventData(event.data);
      yield* mapHermesSseEvent(event.event, data, {
        ids: this.deps.ids,
        applicationRunId: input.applicationRunId,
        externalRunId: input.externalRunId,
        externalSessionId: input.externalSessionId,
      });
    }
  }

  async getRun(input: GetRuntimeRunInput, options?: OperationOptions): Promise<RuntimeRunSnapshot> {
    const response = await this.requireConnected().client.json<Record<string, unknown>>(
      'GET',
      `/v1/runs/${encodeURIComponent(input.externalRunId)}`,
      { signal: options?.signal },
    );
    return {
      applicationRunId: input.applicationRunId,
      externalRunId: input.externalRunId,
      status: normalizeStatus(response.value.status),
      output: stringValue(response.value.output ?? response.value.text),
      usage: response.value.usage && typeof response.value.usage === 'object' ? (response.value.usage as Record<string, number>) : undefined,
      providerState: response.value,
    };
  }

  async cancelRun(input: CancelRuntimeRunInput, options?: OperationOptions): Promise<void> {
    await this.requireConnected().client.json('POST', `/v1/runs/${encodeURIComponent(input.externalRunId)}/stop`, {
      signal: options?.signal,
    });
  }

  async getHistory(_input: GetRuntimeHistoryInput): Promise<RuntimeMessage[]> {
    return [];
  }

  async close(): Promise<void> {
    this.connected = undefined;
  }

  private descriptor(connected: ConnectedHermes) {
    const payload = connected.capabilitiesPayload as Record<string, unknown>;
    return {
      schemaVersion: 1 as const,
      adapterId: this.adapterId,
      adapterVersion: this.adapterVersion,
      runtimeProduct: 'hermes-agent',
      runtimeVersion: stringValue(payload.version),
      protocolName: 'hermes-runs-http',
      protocolVersion: '1',
      endpointFingerprint: connected.descriptorFingerprint,
      capabilities: connected.capabilities,
    };
  }

  private requireConnected(): ConnectedHermes {
    if (!this.connected) {
      throw new RuntimeError({
        code: 'INVALID_CONFIGURATION',
        retryable: false,
        adapterId: this.adapterId,
        message: 'Hermes adapter is not connected',
      });
    }
    return this.connected;
  }
}

export function createHermesAdapterFactory(options?: HermesAdapterOptions) {
  return {
    adapterId: 'hermes',
    create: (dependencies: RuntimeAdapterDependencies) => new HermesAdapter(dependencies, options),
  };
}

function buildRunBody(input: StartRuntimeRunInput, options: HermesAdapterOptions): Record<string, unknown> {
  const providerState = input.session.providerState ?? {};
  const previousResponseId = typeof providerState.previousResponseId === 'string' ? providerState.previousResponseId : undefined;
  const body: Record<string, unknown> = {
    input: input.input.text,
    session_id: input.session.externalSessionId,
    instructions: input.instructions,
    model: options.model,
  };
  if (previousResponseId && options.historyMode !== 'conversation_history') {
    body.previous_response_id = previousResponseId;
  } else if (input.history?.length) {
    body.conversation_history = input.history.map((message) => ({
      role: message.role,
      content: message.content,
    }));
  }
  const images = input.input.attachments?.filter((attachment) => attachment.kind === 'image') ?? [];
  if (images.length > 0) {
    body.attachments = images.map((image) => ({
      type: 'input_image',
      mime_type: image.mimeType,
      name: image.name,
      data: bytesToBase64(image.data),
    }));
  }
  return body;
}

function sessionHeader(sessionId: string, options: HermesAdapterOptions): Record<string, string> {
  return { [options.sessionKeyHeader ?? 'X-Hermes-Session-Key']: sessionId };
}

async function resolveBearerToken(
  deps: RuntimeAdapterDependencies,
  config: RuntimeConnectionConfig,
  options: HermesAdapterOptions,
): Promise<string | undefined> {
  if (options.bearerToken) return options.bearerToken;
  if (config.auth?.kind === 'bearer') return config.auth.token;
  const ref = config.credentialRef ?? options.bearerTokenRef;
  if (!ref) return undefined;
  const secret = await deps.secrets.get(ref);
  if (!secret) return undefined;
  return typeof secret.value === 'string' ? secret.value : new TextDecoder().decode(secret.value);
}

function toHttpBase(endpoint: string): string {
  return endpoint.replace(/^hermes\+http:/, 'http:').replace(/^hermes\+https:/, 'https:').replace(/^agent\+https:/, 'https:');
}

function authToken(_hint: RuntimeTarget['authHint'], token: string | undefined): string | undefined {
  return token;
}

function normalizeStatus(status: unknown) {
  if (status === 'queued' || status === 'running' || status === 'waiting_for_approval' || status === 'stopping') return status;
  if (status === 'started') return 'running';
  if (status === 'completed' || status === 'failed' || status === 'cancelled') return status;
  return 'unknown';
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
