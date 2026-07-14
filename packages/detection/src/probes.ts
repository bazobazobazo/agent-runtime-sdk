import {
  RuntimeError,
  TEXT_RUN_CAPABILITIES,
  withDeadline,
  type RuntimeCapabilities,
} from '@banzae/agent-runtime-core';
import { authHeaders, normalizeDetectionEndpoint, sanitizeDetectionValue } from './security.js';
import type { RuntimeDetectionInput, RuntimeProbe, RuntimeProbeContext, RuntimeProbeResult } from './types.js';

const MAX_RESPONSE_BYTES = 1_000_000;

export function createOpenClawProbe(): RuntimeProbe {
  return {
    adapterId: 'openclaw',
    async probe(input, context) {
      const started = context.dependencies.clock.now().getTime();
      const endpoint = toWebSocketEndpoint(input.target.endpoint);
      let connection;
      try {
        const url = new URL(endpoint);
        await context.networkPolicy.validateTarget(url);
        connection = await withDeadline(
          context.dependencies.webSockets.connect({
            url: endpoint,
            headers: authHeaders(context.auth),
            signal: context.signal,
            maxPayloadBytes: MAX_RESPONSE_BYTES,
          }),
          context.probeTimeoutMs,
          context.signal,
        );
        const challenge = await withDeadline(waitForOpenClawChallenge(connection), context.probeTimeoutMs, context.signal);
        if (!challenge.valid) {
          return noMatch('openclaw', 0, started, context, 'malformed OpenClaw challenge');
        }

        if (!context.auth) {
          return {
            adapterId: 'openclaw',
            matched: true,
            confidence: 0.95,
            runtimeProduct: 'openclaw',
            protocolName: 'openclaw-gateway',
            evidence: [{ kind: 'openclaw.challenge', message: 'validated OpenClaw connect.challenge', confidence: 0.95 }],
            durationMs: elapsed(started, context),
          };
        }

        const hello = await authenticatedOpenClawHello(connection, context, challenge.nonce);
        return {
          adapterId: 'openclaw',
          matched: true,
          confidence: 0.99,
          runtimeProduct: 'openclaw',
          runtimeVersion: hello.runtimeVersion,
          protocolName: `openclaw-gateway-v${hello.protocolVersion}`,
          protocolVersion: String(hello.protocolVersion),
          capabilities: openClawCapabilities(hello),
          evidence: [
            { kind: 'openclaw.challenge', message: 'validated OpenClaw connect.challenge', confidence: 0.95 },
            { kind: 'openclaw.hello', message: 'validated OpenClaw hello response', confidence: 0.99, protocolVersion: String(hello.protocolVersion) },
          ],
          durationMs: elapsed(started, context),
        };
      } catch (error) {
        return probeError('openclaw', started, context, mapOpenClawDetectionError(error));
      } finally {
        await connection?.close().catch(() => undefined);
      }
    },
  };
}

export function createHermesProbe(): RuntimeProbe {
  return {
    adapterId: 'hermes',
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
        if (response.status === 401) return probeError('hermes', started, context, runtimeError('AUTHENTICATION_FAILED', 'Hermes authentication failed', false, { status: 401 }));
        if (response.status === 403) return probeError('hermes', started, context, runtimeError('AUTHORIZATION_FAILED', 'Hermes permission denied', false, { status: 403 }));
        if (response.status === 404) return noMatch('hermes', 0, started, context, 'Hermes capabilities endpoint was not found');
        if (response.status === 429) return probeError('hermes', started, context, runtimeError('RATE_LIMITED', 'Hermes detection was rate limited', true, { status: 429 }));
        if (response.status >= 500) return probeError('hermes', started, context, runtimeError('RUNTIME_UNAVAILABLE', 'Hermes provider unavailable', true, { status: response.status }));
        if (response.status < 200 || response.status >= 300) return noMatch('hermes', 0, started, context, 'Hermes capabilities endpoint did not return success');

        const payload = JSON.parse(await readBody(response.body, MAX_RESPONSE_BYTES)) as unknown;
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

async function waitForOpenClawChallenge(connection: { events(): AsyncIterable<any> }): Promise<{ valid: boolean; nonce?: string }> {
  for await (const event of connection.events()) {
    if (event.type === 'open') continue;
    if (event.type === 'message') {
      const frame = JSON.parse(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data)) as Record<string, unknown>;
      const payload = record(frame.payload);
      return { valid: frame.event === 'connect.challenge' && typeof payload.nonce === 'string', nonce: stringValue(payload.nonce) };
    }
    if (event.type === 'close') throw runtimeError('NETWORK', 'OpenClaw socket closed during challenge detection', true);
  }
  throw runtimeError('TIMEOUT', 'OpenClaw challenge timeout', true, { stage: 'openclaw.challenge' });
}

async function authenticatedOpenClawHello(
  connection: { send(data: string): Promise<void>; events(): AsyncIterable<any> },
  context: RuntimeProbeContext,
  nonce?: string,
): Promise<{ protocolVersion: number; runtimeVersion?: string; methods: string[]; events: string[]; features: Record<string, unknown> }> {
  const protocolVersion = 4;
  await connection.send(
    JSON.stringify({
      type: 'req',
      id: 'detect-connect',
      method: 'connect',
      params: {
        minProtocol: protocolVersion,
        maxProtocol: protocolVersion,
        role: 'operator',
        scopes: ['operator.read'],
        auth: context.auth && 'token' in context.auth ? { token: context.auth.token } : undefined,
        nonce,
      },
    }),
  );
  for await (const event of connection.events()) {
    if (event.type === 'open') continue;
    if (event.type !== 'message') continue;
    const frame = JSON.parse(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data)) as Record<string, unknown>;
    if (frame.type !== 'res' || frame.id !== 'detect-connect') continue;
    if (frame.error) throw mapOpenClawProviderError(frame.error);
    const payload = record(frame.payload);
    const selected = numberValue(payload.protocol ?? payload.protocolVersion ?? payload.selectedProtocol);
    if (selected !== protocolVersion) throw runtimeError('PROTOCOL_MISMATCH', 'OpenClaw selected unsupported protocol during detection', false, { selectedProtocol: selected });
    const features = record(payload.features);
    return {
      protocolVersion,
      runtimeVersion: stringValue(payload.serverVersion ?? payload.version ?? record(payload.server).version),
      methods: stringArray(payload.methods ?? features.methods),
      events: stringArray(payload.events ?? features.events),
      features,
    };
  }
  throw runtimeError('TIMEOUT', 'OpenClaw hello timeout', true, { stage: 'openclaw.hello' });
}

function isHermesCapabilities(payload: unknown): boolean {
  const value = record(payload);
  const features = record(value.features);
  return (
    value.runtime === 'hermes' ||
    value.product === 'hermes' ||
    value.runtimeProduct === 'hermes' ||
    features.session_resources === true ||
    features.tool_progress_events === true ||
    features.approval_events === true ||
    Array.isArray(value.capabilities)
  );
}

function openClawCapabilities(hello: { methods: string[]; events: string[]; features: Record<string, unknown> }): RuntimeCapabilities {
  const methods = new Set(hello.methods);
  return {
    ...TEXT_RUN_CAPABILITIES,
    sessions: { create: methods.has('sessions.create'), resume: true, history: methods.has('chat.history') || methods.has('sessions.get'), fork: false },
    runs: { start: methods.has('chat.send'), status: methods.has('agent.wait'), streamText: true, streamTools: hello.events.some((event) => event.includes('tool')), cancel: methods.has('chat.abort'), approvals: hello.events.some((event) => event.includes('approval')) },
    input: { text: true, images: false, files: false },
    output: { text: true, reasoning: Boolean(hello.features.reasoning), tools: hello.events.some((event) => event.includes('tool')), usage: methods.has('usage.status') || methods.has('sessions.usage') },
    extensions: { 'openclaw.protocol': 4 },
  };
}

function hermesCapabilities(payload: Record<string, unknown>): RuntimeCapabilities {
  const features = record(payload.features);
  return {
    ...TEXT_RUN_CAPABILITIES,
    sessions: { create: Boolean(features.session_resources), resume: true, history: Boolean(features.session_resources), fork: false },
    runs: { start: true, status: true, streamText: true, streamTools: Boolean(features.tool_progress_events), cancel: true, approvals: Boolean(features.approval_events) },
    input: { text: true, images: false, files: false },
    output: { text: true, reasoning: false, tools: Boolean(features.tool_progress_events), usage: true },
    extensions: { 'hermes.protocol': 'hermes-runs-http' },
  };
}

function noMatch(adapterId: string, confidence: number, started: number, context: RuntimeProbeContext, message: string): RuntimeProbeResult {
  return { adapterId, matched: false, confidence, evidence: [{ kind: 'no-match', message }], durationMs: elapsed(started, context) };
}

function probeError(adapterId: string, started: number, context: RuntimeProbeContext, error: RuntimeError): RuntimeProbeResult {
  return { adapterId, matched: false, confidence: 0, evidence: [], error, durationMs: elapsed(started, context) };
}

function mapOpenClawDetectionError(error: unknown): RuntimeError {
  if (error instanceof RuntimeError) return error;
  return runtimeError('RUNTIME_UNAVAILABLE', 'OpenClaw probe failed', true, { error: sanitizeDetectionValue(String(error)) });
}

function mapHermesDetectionError(error: unknown): RuntimeError {
  if (error instanceof RuntimeError) return error;
  return runtimeError('RUNTIME_UNAVAILABLE', 'Hermes probe failed', true, { error: sanitizeDetectionValue(String(error)) });
}

function mapOpenClawProviderError(error: unknown): RuntimeError {
  const value = record(error);
  const message = stringValue(value.message) ?? 'OpenClaw provider error';
  const lower = message.toLowerCase();
  if (lower.includes('pairing')) return runtimeError('PAIRING_REQUIRED', message, false);
  if (lower.includes('auth') || lower.includes('token')) return runtimeError('AUTHENTICATION_FAILED', message, false);
  if (lower.includes('permission') || lower.includes('scope')) return runtimeError('AUTHORIZATION_FAILED', message, false);
  if (lower.includes('protocol')) return runtimeError('PROTOCOL_MISMATCH', message, false);
  return runtimeError('PROVIDER_ERROR', message, false);
}

function runtimeError(code: ConstructorParameters<typeof RuntimeError>[0]['code'], message: string, retryable: boolean, details?: Record<string, unknown>): RuntimeError {
  return new RuntimeError({ code, message, retryable, adapterId: 'detection', details: sanitizeDetectionValue(details ?? {}) as Record<string, unknown> });
}

async function readBody(body: AsyncIterable<Uint8Array>, maxBytes: number): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > maxBytes) throw runtimeError('PROVIDER_ERROR', 'Detection response exceeded maximum size', false, { maxBytes });
    chunks.push(chunk);
  }
  return new TextDecoder().decode(concat(chunks, size));
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
