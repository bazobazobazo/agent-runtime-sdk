import type {
  CancelRuntimeRunInput,
  EnsureSessionInput,
  GetRuntimeHistoryInput,
  GetRuntimeRunInput,
  RuntimeAdapterDependencies,
  RuntimeCapabilities,
  RuntimeEvent,
  StartRuntimeRunInput,
} from '@banzae/agent-runtime-core';
import type { RuntimeError } from '@banzae/agent-runtime-core';

export type OpenClawFrame =
  | { type: 'event'; event: string; payload?: unknown; seq?: number; eventId?: string; timestamp?: string }
  | { type: 'req'; id: string; method: string; params?: unknown }
  | { type: 'res'; id: string; ok?: boolean; payload?: unknown; error?: unknown }
  | { type: 'hello-ok'; [key: string]: unknown };

export type OpenClawRpcRequest = {
  id: string;
  method: string;
  params?: Record<string, unknown>;
};

export type OpenClawConnectInput = {
  requestId: string;
  nonce?: string;
  auth?: {
    kind: 'bearer' | 'token' | 'password' | 'device-token' | 'none';
    token?: string;
    password?: string;
    username?: string;
    deviceId?: string;
  };
  role?: string;
  scopes?: string[];
  clientName?: string;
  clientId?: string;
  clientVersion?: string;
  clientPlatform?: string;
  clientMode?: string;
  locale?: string;
  userAgent?: string;
  deviceToken?: string;
  device?: {
    id: string;
    publicKey: string;
    signature: string;
    signedAt: number;
    nonce: string;
  };
};

export type OpenClawHello = {
  protocolVersion: number;
  runtimeVersion?: string;
  connectionId?: string;
  methods: string[];
  events: string[];
  features: Record<string, unknown>;
  raw: unknown;
};

export type OpenClawRunContext = {
  applicationRunId: string;
  externalRunId: string;
  externalSessionId: string;
  includeRawProviderPayload?: boolean;
  clock: RuntimeAdapterDependencies['clock'];
  ids: RuntimeAdapterDependencies['ids'];
};

export type OpenClawProviderEventMetadata = {
  eventType: string;
  providerRunId?: string;
  sessionKey?: string;
  providerEventId?: string;
  sequence?: number;
  occurredAt?: string;
  terminal?: 'completed' | 'failed' | 'cancelled' | 'timeout';
};

export interface OpenClawProtocolCodec {
  readonly protocolVersion: number;
  readonly protocolName: `openclaw-gateway-v${number}`;

  createConnectParams(input: OpenClawConnectInput): Record<string, unknown>;
  parseHello(payload: unknown): OpenClawHello;
  parseFrame(input: string | Uint8Array): OpenClawFrame;
  encodeRequest(input: OpenClawRpcRequest): string;
  extractProviderEventMetadata(event: Extract<OpenClawFrame, { type: 'event' }>): OpenClawProviderEventMetadata;
  mapProviderEvent(event: Extract<OpenClawFrame, { type: 'event' }>, context: OpenClawRunContext): RuntimeEvent[];
  mapError(error: unknown): RuntimeError;
  supportsMethod(method: string, hello: OpenClawHello): boolean;
  capabilities(hello?: OpenClawHello): RuntimeCapabilities;
  buildSessionCreate(input: EnsureSessionInput): OpenClawRpcRequest;
  buildRunStart(input: StartRuntimeRunInput): OpenClawRpcRequest;
  buildRunWait(input: GetRuntimeRunInput): OpenClawRpcRequest;
  buildHistory(input: GetRuntimeHistoryInput): OpenClawRpcRequest;
  buildCancel(input: CancelRuntimeRunInput): OpenClawRpcRequest;
}
