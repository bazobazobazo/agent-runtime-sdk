export type RuntimeTarget = {
  endpoint: string;
  authHint?: 'bearer' | 'token' | 'password' | 'device' | 'none';
  adapterHint?: string;
  transportHint?: 'websocket' | 'http' | 'stdio';
  metadata?: Readonly<Record<string, string>>;
};

export type RuntimeConnectionConfig = {
  target: RuntimeTarget;
  credentialRef?: string;
  auth?: RuntimeAuthInput;
  requestedCapabilities?: RuntimeCapabilityName[];
  options?: Readonly<Record<string, unknown>>;
};

export type RuntimeDescriptor = {
  schemaVersion: 1;
  adapterId: string;
  adapterVersion: string;
  runtimeProduct: string;
  runtimeVersion?: string;
  protocolName: string;
  protocolVersion?: string;
  endpointFingerprint?: string;
  capabilities: RuntimeCapabilities;
};

export type RuntimeCapabilities = {
  schemaVersion: 1;
  sessions: {
    create: boolean;
    resume: boolean;
    history: boolean;
    fork: boolean;
  };
  runs: {
    start: boolean;
    status: boolean;
    streamText: boolean;
    streamTools: boolean;
    cancel: boolean;
    approvals: boolean;
  };
  input: {
    text: boolean;
    images: boolean;
    files: boolean;
  };
  output: {
    text: boolean;
    reasoning: boolean;
    tools: boolean;
    usage: boolean;
  };
  extensions: Readonly<Record<string, boolean | string | number>>;
};

export type RuntimeCapabilityName =
  | 'sessions.create'
  | 'sessions.resume'
  | 'sessions.history'
  | 'sessions.fork'
  | 'runs.start'
  | 'runs.status'
  | 'runs.streamText'
  | 'runs.streamTools'
  | 'runs.cancel'
  | 'runs.approvals'
  | 'input.text'
  | 'input.images'
  | 'input.files'
  | 'output.text'
  | 'output.reasoning'
  | 'output.tools'
  | 'output.usage';

export type RuntimeAuthInput =
  | { kind: 'bearer'; token: string }
  | { kind: 'token'; token: string }
  | { kind: 'password'; password: string; username?: string }
  | { kind: 'device-token'; token: string; deviceId?: string }
  | { kind: 'none' };

export type OperationOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  traceId?: string;
};

export type ProbeOptions = OperationOptions & {
  allowAuthentication?: boolean;
};

export type ConnectOptions = OperationOptions & {
  forceReconnect?: boolean;
};

export type RuntimeConnectionInfo = {
  descriptor: RuntimeDescriptor;
  connectedAt: string;
  connectionId?: string;
  warnings: string[];
};

export type RuntimeHealth = {
  status: 'healthy' | 'degraded' | 'unavailable';
  checkedAt: string;
  latencyMs?: number;
  descriptor?: RuntimeDescriptor;
  warnings: string[];
  details?: Readonly<Record<string, unknown>>;
};

export type RuntimeProbeResult = {
  matched: boolean;
  confidence: number;
  adapterId?: string;
  runtimeProduct?: string;
  runtimeVersion?: string;
  protocolName?: string;
  protocolVersion?: string;
  endpointFingerprint?: string;
  capabilities?: RuntimeCapabilities;
  evidence: string[];
  warnings: string[];
  durationMs: number;
};

export type EnsureSessionInput = {
  applicationSessionId: string;
  title?: string;
  metadata?: Readonly<Record<string, string>>;
  providerState?: Readonly<Record<string, unknown>>;
};

export type RuntimeSession = {
  applicationSessionId: string;
  externalSessionId: string;
  providerState?: Readonly<Record<string, unknown>>;
  created: boolean;
};

export type RuntimeUserInput = {
  text: string;
  attachments?: RuntimeAttachment[];
};

export type RuntimeAttachment =
  | {
      kind: 'image';
      mimeType: string;
      name?: string;
      data: Uint8Array;
    }
  | {
      kind: 'file';
      mimeType: string;
      name: string;
      data?: Uint8Array;
      uri?: string;
    };

export type StartRuntimeRunInput = {
  applicationRunId: string;
  idempotencyKey: string;
  session: RuntimeSession;
  input: RuntimeUserInput;
  instructions?: string;
  history?: RuntimeMessage[];
  timeoutMs?: number;
  metadata?: Readonly<Record<string, string>>;
};

export type RuntimeRunHandle = {
  applicationRunId: string;
  externalRunId: string;
  status: RuntimeRunStatus;
  providerState?: Readonly<Record<string, unknown>>;
};

export type RuntimeRunStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_approval'
  | 'stopping'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'unknown';

export type StreamRuntimeRunInput = {
  applicationRunId: string;
  externalRunId: string;
  externalSessionId: string;
  cursor?: string;
  providerState?: Readonly<Record<string, unknown>>;
};

export type GetRuntimeRunInput = {
  applicationRunId: string;
  externalRunId: string;
  externalSessionId?: string;
  providerState?: Readonly<Record<string, unknown>>;
};

export type CancelRuntimeRunInput = GetRuntimeRunInput;

export type GetRuntimeHistoryInput = {
  applicationSessionId: string;
  externalSessionId: string;
  limit?: number;
  cursor?: string;
  providerState?: Readonly<Record<string, unknown>>;
};

export type RuntimeRunSnapshot = {
  applicationRunId: string;
  externalRunId: string;
  status: RuntimeRunStatus;
  output?: string;
  usage?: Readonly<Record<string, number>>;
  error?: {
    code: RuntimeErrorCode;
    message: string;
    retryable: boolean;
  };
  providerState?: Readonly<Record<string, unknown>>;
};

export type RuntimeMessage = {
  id?: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  createdAt?: string;
  attachments?: Array<{
    kind: 'image' | 'file';
    name?: string;
    mimeType?: string;
    uri?: string;
  }>;
  metadata?: Readonly<Record<string, unknown>>;
};

export type RuntimeEventName =
  | 'run.queued'
  | 'run.started'
  | 'assistant.delta'
  | 'assistant.completed'
  | 'reasoning.delta'
  | 'tool.started'
  | 'tool.updated'
  | 'tool.completed'
  | 'approval.requested'
  | 'approval.resolved'
  | 'usage.updated'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled'
  | 'transport.warning'
  | 'transport.gap';

export type RuntimeEventBase = {
  schemaVersion: 1;
  eventId: string;
  sequence?: number;
  occurredAt: string;
  applicationRunId: string;
  externalRunId: string;
  externalSessionId: string;
  provider?: {
    adapterId: string;
    eventName?: string;
    raw?: unknown;
  };
  duplicate?: boolean;
};

export type RuntimeQueuedEvent = RuntimeEventBase & { type: 'run.queued' };
export type RuntimeStartedEvent = RuntimeEventBase & { type: 'run.started' };
export type AssistantDeltaEvent = RuntimeEventBase & {
  type: 'assistant.delta';
  delta: string;
};
export type AssistantCompletedEvent = RuntimeEventBase & {
  type: 'assistant.completed';
  text: string;
};
export type ReasoningDeltaEvent = RuntimeEventBase & {
  type: 'reasoning.delta';
  delta: string;
};
export type ToolStartedEvent = RuntimeEventBase & {
  type: 'tool.started';
  toolCallId: string;
  name?: string;
};
export type ToolUpdatedEvent = RuntimeEventBase & {
  type: 'tool.updated';
  toolCallId: string;
  status?: string;
};
export type ToolCompletedEvent = RuntimeEventBase & {
  type: 'tool.completed';
  toolCallId: string;
  result?: unknown;
};
export type ApprovalRequestedEvent = RuntimeEventBase & {
  type: 'approval.requested';
  approvalId: string;
  description: string;
};
export type ApprovalResolvedEvent = RuntimeEventBase & {
  type: 'approval.resolved';
  approvalId: string;
  decision: 'approve' | 'deny';
};
export type UsageUpdatedEvent = RuntimeEventBase & {
  type: 'usage.updated';
  usage: Readonly<Record<string, number>>;
};
export type RunCompletedEvent = RuntimeEventBase & { type: 'run.completed' };
export type RunFailedEvent = RuntimeEventBase & {
  type: 'run.failed';
  error: {
    code: RuntimeErrorCode;
    message: string;
    retryable: boolean;
  };
};
export type RunCancelledEvent = RuntimeEventBase & { type: 'run.cancelled' };
export type TransportWarningEvent = RuntimeEventBase & {
  type: 'transport.warning';
  warning: string;
};
export type TransportGapEvent = RuntimeEventBase & {
  type: 'transport.gap';
  expected?: number;
  actual?: number;
};

export type RuntimeEvent =
  | RuntimeQueuedEvent
  | RuntimeStartedEvent
  | AssistantDeltaEvent
  | AssistantCompletedEvent
  | ReasoningDeltaEvent
  | ToolStartedEvent
  | ToolUpdatedEvent
  | ToolCompletedEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | UsageUpdatedEvent
  | RunCompletedEvent
  | RunFailedEvent
  | RunCancelledEvent
  | TransportWarningEvent
  | TransportGapEvent;

export type RuntimeErrorCode =
  | 'DETECTION_FAILED'
  | 'DETECTION_AMBIGUOUS'
  | 'AUTHENTICATION_REQUIRED'
  | 'AUTHENTICATION_FAILED'
  | 'AUTHORIZATION_FAILED'
  | 'PAIRING_REQUIRED'
  | 'PROTOCOL_MISMATCH'
  | 'UNSUPPORTED_CAPABILITY'
  | 'INVALID_CONFIGURATION'
  | 'INVALID_REQUEST'
  | 'RUNTIME_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'CANCELLED'
  | 'PROVIDER_ERROR'
  | 'OUTCOME_UNKNOWN'
  | 'INTERNAL';

export type RuntimeHttpRequest = {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  headers?: Readonly<Record<string, string>>;
  body?: string | Uint8Array;
  signal?: AbortSignal;
};

export type RuntimeHttpResponse = {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: AsyncIterable<Uint8Array>;
};

export type RuntimeWebSocketEvent =
  | { type: 'open' }
  | { type: 'message'; data: string | Uint8Array }
  | { type: 'error'; error: unknown }
  | { type: 'close'; code?: number; reason?: string };

export type RuntimeSecret = {
  value: string | Uint8Array;
  contentType?: string;
  expiresAt?: string;
};
