import {
  RuntimeError,
  NO_CAPABILITIES,
  type RuntimeCapabilities,
  type RuntimeWebSocketConnection,
  type RuntimeWebSocketEvent,
} from '@banzae/agent-runtime-core';
import { withDeadline } from '@banzae/agent-runtime-core/experimental';
import {
  OpenClawProtocolRegistry,
  openClawV3Codec,
  openClawV4Codec,
  type OpenClawChallenge,
  type OpenClawFrame,
  type OpenClawHello,
  type OpenClawProtocolCodec,
} from '@banzae/agent-runtime-openclaw/experimental';
import { authHeaders, normalizeDetectionEndpoint, sanitizeDetectionValue } from './security.js';
import type { PersistedRuntimeDetection, RuntimeDetectionInput, RuntimeProbe, RuntimeProbeContext, RuntimeProbeResult } from './types.js';

const MAX_RESPONSE_BYTES = 1_000_000;
const OPENCLAW_CODECS = new OpenClawProtocolRegistry();
OPENCLAW_CODECS.register(openClawV4Codec());
OPENCLAW_CODECS.register(openClawV3Codec());
const OPENCLAW_DETECTION_ORDER = [4, 3] as const;

/** Public alpha contract for create open claw probe. */
export function createOpenClawProbe(): RuntimeProbe {
  return {
    adapterId: 'openclaw',
    supportsDetectionCache: supportsOpenClawDetectionCache,
    async probe(input, context) {
      const started = context.dependencies.clock.now().getTime();
      const endpoint = toWebSocketEndpoint(input.target.endpoint);
      try {
        const url = new URL(endpoint);
        await context.networkPolicy.validateTarget(url);
        if (!context.auth) {
          const result = await challengeOnlyOpenClawDetection(endpoint, context);
          if (!result.challenge) return noMatch('openclaw', 0, started, context, 'malformed OpenClaw challenge');
          return {
            adapterId: 'openclaw',
            matched: true,
            confidence: 0.95,
            runtimeProduct: 'openclaw',
            protocolName: result.codec.protocolName,
            protocolVersion: String(result.codec.protocolVersion),
            evidence: [{ kind: 'openclaw.challenge', message: 'validated OpenClaw connect.challenge', confidence: 0.95 }],
            durationMs: elapsed(started, context),
          };
        }

        const { hello, codec } = await authenticatedOpenClawDetection(endpoint, context);
        return {
          adapterId: 'openclaw',
          matched: true,
          confidence: 0.99,
          runtimeProduct: 'openclaw',
          runtimeVersion: hello.runtimeVersion,
          protocolName: codec.protocolName,
          protocolVersion: String(hello.protocolVersion),
          capabilities: codec.capabilities(hello),
          evidence: [
            { kind: 'openclaw.challenge', message: 'validated OpenClaw connect.challenge', confidence: 0.95 },
            { kind: 'openclaw.hello', message: 'validated OpenClaw hello response', confidence: 0.99, protocolVersion: String(hello.protocolVersion) },
          ],
          durationMs: elapsed(started, context),
        };
      } catch (error) {
        return probeError('openclaw', started, context, mapOpenClawDetectionError(error));
      }
    },
  };
}

/** Public alpha contract for create hermes probe. */
export function createHermesProbe(): RuntimeProbe {
  return {
    adapterId: 'hermes',
    supportsDetectionCache: supportsHermesDetectionCache,
    async probe(input, context) {
      const started = context.dependencies.clock.now().getTime();
      try {
        const base = normalizeHttpEndpoint(input.target.endpoint);
        const capabilitiesUrl = new URL('/v1/capabilities', base);
        await context.networkPolicy.validateTarget(capabilitiesUrl);
        const response = await withDeadline(
          context.dependencies.http.request({
            url: capabilitiesUrl.toString(),
            method: 'GET',
            headers: authHeaders(context.auth),
            signal: context.signal,
          }),
          context.probeTimeoutMs,
          context.signal,
        );
        if (response.status === 401) {
          await closeBody(response.body);
          return probeError(
            'hermes',
            started,
            context,
            runtimeError(context.auth ? 'AUTHENTICATION_FAILED' : 'AUTHENTICATION_REQUIRED', context.auth ? 'Hermes authentication failed' : 'Hermes authentication is required', false, {
              status: 401,
              stage: 'hermes.capabilities',
              authenticationRequired: !context.auth,
            }),
          );
        }
        if (response.status === 403) {
          await closeBody(response.body);
          return probeError('hermes', started, context, runtimeError('PERMISSION_DENIED', 'Hermes permission denied', false, { status: 403, stage: 'hermes.capabilities' }));
        }
        if (response.status === 404) {
          await closeBody(response.body);
          return noMatch('hermes', 0, started, context, 'Hermes capabilities endpoint was not found');
        }
        if (response.status === 429) {
          await closeBody(response.body);
          return probeError('hermes', started, context, runtimeError('RATE_LIMITED', 'Hermes detection was rate limited', true, { status: 429, stage: 'hermes.capabilities' }));
        }
        if (response.status >= 500) {
          await closeBody(response.body);
          return probeError('hermes', started, context, runtimeError('PROVIDER_UNAVAILABLE', 'Hermes provider unavailable', true, { status: response.status, stage: 'hermes.capabilities' }));
        }
        if (response.status < 200 || response.status >= 300) {
          await closeBody(response.body);
          return noMatch('hermes', 0, started, context, 'Hermes capabilities endpoint did not return success');
        }

        const payload = JSON.parse(await readBody(response.body, MAX_RESPONSE_BYTES, context.signal)) as unknown;
        if (!isHermesCapabilities(payload)) return noMatch('hermes', 0, started, context, 'response was not Hermes capabilities');
        const record = payload as Record<string, unknown>;
        return {
          adapterId: 'hermes',
          matched: true,
          confidence: 0.99,
          runtimeProduct: 'hermes',
          runtimeVersion: stringValue(record.version ?? record.runtimeVersion),
          protocolName: 'hermes-runs-http',
          protocolVersion: '1',
          capabilities: hermesCapabilities(record),
          evidence: [{ kind: 'hermes.capabilities', message: 'validated Hermes capabilities response', confidence: 0.99 }],
          durationMs: elapsed(started, context),
        };
      } catch (error) {
        return probeError('hermes', started, context, mapHermesDetectionError(error));
      }
    },
  };
}

async function challengeOnlyOpenClawDetection(endpoint: string, context: RuntimeProbeContext): Promise<{ challenge?: OpenClawChallenge; codec: OpenClawProtocolCodec }> {
  const codec = OPENCLAW_CODECS.require(4);
  const connection = await openOpenClawSocket(endpoint, context);
  try {
    const challenge = await waitForOpenClawChallenge(connection, codec, context.signal);
    return { challenge, codec };
  } finally {
    await connection.close().catch(() => undefined);
  }
}

async function authenticatedOpenClawDetection(endpoint: string, context: RuntimeProbeContext): Promise<{ hello: OpenClawHello; codec: OpenClawProtocolCodec }> {
  let lastMismatch: RuntimeError | undefined;
  for (const version of OPENCLAW_DETECTION_ORDER) {
    const codec = OPENCLAW_CODECS.require(version);
    try {
      return await authenticatedOpenClawAttempt(endpoint, context, codec);
    } catch (error) {
      const mapped = mapOpenClawDetectionError(error);
      if (mapped.code === 'PROTOCOL_MISMATCH' && version === 4) {
        lastMismatch = mapped;
        continue;
      }
      throw mapped;
    }
  }
  throw lastMismatch ?? runtimeError('PROTOCOL_MISMATCH', 'OpenClaw protocol negotiation failed', false, { stage: 'openclaw.hello' });
}

async function authenticatedOpenClawAttempt(
  endpoint: string,
  context: RuntimeProbeContext,
  codec: OpenClawProtocolCodec,
): Promise<{ hello: OpenClawHello; codec: OpenClawProtocolCodec }> {
  const connection = await openOpenClawSocket(endpoint, context);
  try {
    const challenge = await waitForOpenClawChallenge(connection, codec, context.signal);
    await sendAuthenticatedOpenClawHello(connection, context, codec, challenge.nonce);
    const hello = await waitForOpenClawHello(connection, codec, context.signal);
    return { hello, codec };
  } finally {
    await connection.close().catch(() => undefined);
  }
}

async function openOpenClawSocket(endpoint: string, context: RuntimeProbeContext): Promise<RuntimeWebSocketConnection> {
  throwIfAborted(context.signal);
  const connection = await withDeadline(
    context.dependencies.webSockets.connect({
      url: endpoint,
      headers: authHeaders(context.auth),
      signal: context.signal,
      maxPayloadBytes: MAX_RESPONSE_BYTES,
    }),
    context.probeTimeoutMs,
    context.signal,
  );
  const onAbort = () => {
    void connection.close().catch(() => undefined);
  };
  context.signal?.addEventListener('abort', onAbort, { once: true });
  return new AbortLinkedWebSocketConnection(connection, () => context.signal?.removeEventListener('abort', onAbort));
}

async function waitForOpenClawChallenge(
  connection: RuntimeWebSocketConnection,
  codec: OpenClawProtocolCodec,
  signal?: AbortSignal,
): Promise<OpenClawChallenge> {
  for await (const event of signalAwareEvents(connection, signal)) {
    if (event.type === 'open') continue;
    if (event.type === 'message') {
      const frame = codec.parseFrame(event.data);
      const challenge = codec.parseChallenge(frame);
      if (!challenge) throw runtimeError('PROVIDER_ERROR', 'OpenClaw challenge was malformed', false, { stage: 'openclaw.challenge', protocolVersion: String(codec.protocolVersion) });
      return challenge;
    }
    if (event.type === 'close') throw runtimeError('NETWORK', 'OpenClaw socket closed during challenge detection', true);
    if (event.type === 'error') throw runtimeError('NETWORK', 'OpenClaw socket errored during challenge detection', true, safeErrorDetails(event.error, 'openclaw.challenge'));
  }
  throw runtimeError('TIMEOUT', 'OpenClaw challenge timeout', true, { stage: 'openclaw.challenge' });
}

async function sendAuthenticatedOpenClawHello(
  connection: RuntimeWebSocketConnection,
  context: RuntimeProbeContext,
  codec: OpenClawProtocolCodec,
  nonce?: string,
): Promise<void> {
  throwIfAborted(context.signal);
  await connection.send(
    codec.encodeRequest({
      id: 'detect-connect',
      method: 'connect',
      params: codec.createConnectParams({
        requestId: 'detect-connect',
        nonce,
        auth: authForOpenClaw(context),
        role: 'operator',
        scopes: ['operator.read'],
        clientName: '@banzae/agent-runtime-detection',
        clientVersion: '0.1.0',
      }),
    }),
  );
}

async function waitForOpenClawHello(
  connection: RuntimeWebSocketConnection,
  codec: OpenClawProtocolCodec,
  signal?: AbortSignal,
): Promise<OpenClawHello> {
  for await (const event of signalAwareEvents(connection, signal)) {
    if (event.type === 'open') continue;
    if (event.type !== 'message') continue;
    const frame = codec.parseFrame(event.data);
    if (frame.type !== 'res' || frame.id !== 'detect-connect') continue;
    if (frame.error) throw mapOpenClawProviderError(frame.error, codec.protocolVersion);
    return codec.parseHello(frame.payload);
  }
  throw runtimeError('TIMEOUT', 'OpenClaw hello timeout', true, { stage: 'openclaw.hello' });
}

function isHermesCapabilities(payload: unknown): boolean {
  const value = record(payload);
  const features = record(value.features);
  const explicitIdentity = value.runtime === 'hermes' || value.product === 'hermes' || value.runtimeProduct === 'hermes';
  const documentedSchema = value.object === 'hermes.api_server.capabilities' && value.platform === 'hermes-agent';
  if (value.features !== undefined && (typeof value.features !== 'object' || Array.isArray(value.features))) return false;
  if (value.capabilities !== undefined && !Array.isArray(value.capabilities)) return false;
  return (explicitIdentity || documentedSchema) && hasHermesFeatureEvidence(features);
}

function hasHermesFeatureEvidence(features: Record<string, unknown>): boolean {
  const keys = ['run_submission', 'run_status', 'run_events_sse', 'session_resources', 'tool_progress_events', 'approval_events'];
  return keys.filter((key) => typeof features[key] === 'boolean').length >= 2;
}

function hermesCapabilities(payload: Record<string, unknown>): RuntimeCapabilities {
  const features = record(payload.features);
  const endpoints = record(payload.endpoints);
  const start = features.run_submission === true && detectionEndpoint(endpoints.runs, 'POST', '/v1/runs');
  const status = features.run_status === true && detectionEndpoint(endpoints.run_status, 'GET', '/v1/runs/{run_id}');
  const stream = features.run_events_sse === true && detectionEndpoint(endpoints.run_events, 'GET', '/v1/runs/{run_id}/events');
  const cancel = features.run_stop === true && detectionEndpoint(endpoints.run_stop, 'POST', '/v1/runs/{run_id}/stop');
  const approvals = features.run_approval_response === true
    && features.approval_events === true
    && detectionEndpoint(endpoints.run_approval, 'POST', '/v1/runs/{run_id}/approval');
  const sessionCreate = detectionEndpoint(endpoints.session_create, 'POST', '/api/sessions');
  const sessionHistory = detectionEndpoint(endpoints.session_messages, 'GET', '/api/sessions/{session_id}/messages');
  const tools = stream && features.tool_progress_events === true;
  return {
    ...NO_CAPABILITIES,
    sessions: { create: sessionCreate, resume: start, history: sessionHistory, fork: false },
    runs: { start, status, stream, cancel, approvals },
    input: { text: start, images: false, files: false },
    output: { text: status || stream, reasoning: false, tools, usage: false },
    health: { liveness: true, readiness: false },
    extensions: {
      'hermes.protocol': 'hermes-runs-http',
      'hermes.long_term_session_key': features.session_key_header === 'X-Hermes-Session-Key',
      'hermes.session_id_header': features.session_continuity_header === 'X-Hermes-Session-Id',
    },
  };
}

function detectionEndpoint(value: unknown, method: string, path: string): boolean {
  const endpoint = record(value);
  return endpoint.method === method && endpoint.path === path;
}

function noMatch(adapterId: string, confidence: number, started: number, context: RuntimeProbeContext, message: string): RuntimeProbeResult {
  return { adapterId, matched: false, confidence, evidence: [{ kind: 'no-match', message }], durationMs: elapsed(started, context) };
}

function probeError(adapterId: string, started: number, context: RuntimeProbeContext, error: RuntimeError): RuntimeProbeResult {
  return { adapterId, matched: false, confidence: 0, evidence: [], error, durationMs: elapsed(started, context) };
}

function mapOpenClawDetectionError(error: unknown): RuntimeError {
  if (error instanceof RuntimeError) return error;
  return runtimeError('PROVIDER_UNAVAILABLE', 'OpenClaw probe failed', true, safeErrorDetails(error, 'openclaw.probe'));
}

function mapHermesDetectionError(error: unknown): RuntimeError {
  if (error instanceof RuntimeError) return error;
  return runtimeError('PROVIDER_UNAVAILABLE', 'Hermes probe failed', true, safeErrorDetails(error, 'hermes.capabilities'));
}

function mapOpenClawProviderError(error: unknown, protocolVersion: number): RuntimeError {
  const value = record(error);
  const message = stringValue(value.message) ?? 'OpenClaw provider error';
  const lower = message.toLowerCase();
  const code = stringValue(value.code)?.toUpperCase();
  const detailCode = stringValue(record(value.details).code)?.toUpperCase();
  const details = { ...safeErrorDetails(error, 'openclaw.hello'), protocolVersion: String(protocolVersion) };
  if (code === 'PAIRING_REQUIRED' || detailCode === 'PAIRING_REQUIRED' || lower.includes('pairing')) return runtimeError('PAIRING_REQUIRED', 'OpenClaw pairing is required', false, details);
  if (code === 'AUTHENTICATION_FAILED' || detailCode === 'AUTHENTICATION_FAILED' || lower.includes('auth') || lower.includes('token')) return runtimeError('AUTHENTICATION_FAILED', 'OpenClaw authentication failed', false, details);
  if (code === 'AUTHORIZATION_FAILED' || code === 'PERMISSION_DENIED' || detailCode === 'AUTHORIZATION_FAILED' || detailCode === 'PERMISSION_DENIED' || lower.includes('permission') || lower.includes('scope')) return runtimeError('PERMISSION_DENIED', 'OpenClaw permission denied', false, details);
  if (code === 'PROTOCOL_MISMATCH' || detailCode === 'PROTOCOL_MISMATCH' || lower.includes('protocol')) return runtimeError('PROTOCOL_MISMATCH', 'OpenClaw protocol mismatch', false, details);
  return runtimeError('PROVIDER_ERROR', 'OpenClaw provider rejected detection hello', false, details);
}

function runtimeError(code: ConstructorParameters<typeof RuntimeError>[0]['code'], message: string, retryable: boolean, details?: Record<string, unknown>): RuntimeError {
  return new RuntimeError({ code, message, retryable, adapterId: 'detection', details: sanitizeDetectionValue(details ?? {}) as Record<string, unknown> });
}

async function readBody(body: AsyncIterable<Uint8Array>, maxBytes: number, signal?: AbortSignal): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const iterator = body[Symbol.asyncIterator]();
  let done = false;
  const onAbort = () => {
    void iterator.return?.();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    while (true) {
      throwIfAborted(signal);
      const next = await iterator.next();
      if (next.done) {
        done = true;
        break;
      }
      const chunk = next.value;
      size += chunk.byteLength;
      if (size > maxBytes) throw runtimeError('PROVIDER_ERROR', 'Detection response exceeded maximum size', false, { maxBytes });
      chunks.push(chunk);
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (!done) await iterator.return?.().catch(() => undefined);
  }
  return new TextDecoder().decode(concat(chunks, size));
}

async function closeBody(body: AsyncIterable<Uint8Array>): Promise<void> {
  const iterator = body[Symbol.asyncIterator]();
  await iterator.return?.().catch(() => undefined);
}

function concat(chunks: Uint8Array[], size: number): Uint8Array {
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function toWebSocketEndpoint(endpoint: string): string {
  return normalizeDetectionEndpoint(endpoint).replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
}

function normalizeHttpEndpoint(endpoint: string): string {
  return normalizeDetectionEndpoint(endpoint).replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
}

function elapsed(started: number, context: RuntimeProbeContext): number {
  return context.dependencies.clock.now().getTime() - started;
}

async function* signalAwareEvents(connection: RuntimeWebSocketConnection, signal?: AbortSignal): AsyncIterable<RuntimeWebSocketEvent> {
  const iterator = connection.events()[Symbol.asyncIterator]();
  const onAbort = () => {
    void iterator.return?.();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    while (true) {
      throwIfAborted(signal);
      const next = await iterator.next();
      if (next.done) return;
      yield next.value;
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await iterator.return?.().catch(() => undefined);
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof RuntimeError
      ? signal.reason
      : runtimeError('CANCELLED', 'Runtime detection was cancelled', false);
  }
}

function authForOpenClaw(context: RuntimeProbeContext) {
  const auth = context.auth;
  if (!auth || auth.kind === 'none') return undefined;
  if (auth.kind === 'token' || auth.kind === 'bearer' || auth.kind === 'device-token') return { kind: auth.kind, token: auth.token };
  return { kind: auth.kind, username: auth.username, password: auth.password };
}

function safeErrorDetails(error: unknown, stage: string): Record<string, unknown> {
  const details: Record<string, unknown> = { stage };
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    if (typeof value.code === 'string') details.providerCode = sanitizeDetectionValue(value.code);
    if (typeof value.status === 'number') details.status = value.status;
    if (typeof value.name === 'string') details.providerErrorName = sanitizeDetectionValue(value.name);
  }
  return details;
}

function supportsOpenClawDetectionCache(detection: PersistedRuntimeDetection): boolean {
  const version = Number(detection.protocolVersion);
  return (detection.protocolName === 'openclaw-gateway-v4' && version === 4) || (detection.protocolName === 'openclaw-gateway-v3' && version === 3);
}

function supportsHermesDetectionCache(detection: PersistedRuntimeDetection): boolean {
  return detection.protocolName === 'hermes-runs-http' && detection.protocolVersion === '1';
}

class AbortLinkedWebSocketConnection implements RuntimeWebSocketConnection {
  constructor(
    private readonly connection: RuntimeWebSocketConnection,
    private readonly cleanup: () => void,
  ) {}

  send(data: string | Uint8Array): Promise<void> {
    return this.connection.send(data);
  }

  events(): AsyncIterable<RuntimeWebSocketEvent> {
    return this.connection.events();
  }

  async close(code?: number, reason?: string): Promise<void> {
    this.cleanup();
    await this.connection.close(code, reason);
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
