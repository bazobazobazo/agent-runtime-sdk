export type ApplicationSessionId = string;
export type ExternalSessionId = string;
export type ApplicationRunId = string;
export type ExternalRunId = string;
export type NormalizedEventId = string;
export type ProviderEventId = string;
export type RuntimeApprovalId = string;
export type RuntimeIdempotencyKey = string;
export type RuntimeEndpointFingerprint = string;
export type RuntimeCredentialReference = string;

export type RuntimeTarget = {
  /** Absolute runtime endpoint. Strings are normalized and validated before network use. */
  endpoint: string;
  authHint?: 'bearer' | 'token' | 'password' | 'device' | 'none';
  adapterHint?: string;
  transportHint?: 'websocket' | 'http' | 'stdio';
  metadata?: Readonly<Record<string, string>>;
};

export type RuntimeConnectionConfig = {
  target: RuntimeTarget;
  credentialRef?: RuntimeCredentialReference;
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
  endpointFingerprint?: RuntimeEndpointFingerprint;
  capabilities: RuntimeCapabilities;
  /** ISO-8601 UTC observation time supplied by the SDK clock. */
  observedAt?: string;
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
    stream: boolean;
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
  health: {
    liveness: boolean;
    readiness: boolean;
  };
  extensions: RuntimeCapabilityExtensions;
};

/** Provider extensions are namespaced and remain outside the common model. */
export type RuntimeCapabilityExtensionValue = boolean | string | number;
export type RuntimeCapabilityExtensions = Readonly<
  Record<`${string}.${string}`, RuntimeCapabilityExtensionValue>
>;

export type RuntimeCapabilityName =
  | 'sessions.create'
  | 'sessions.resume'
  | 'sessions.history'
  | 'sessions.fork'
  | 'runs.start'
  | 'runs.status'
  | 'runs.stream'
  | 'runs.cancel'
  | 'runs.approvals'
  | 'input.text'
  | 'input.images'
  | 'input.files'
  | 'output.text'
  | 'output.reasoning'
  | 'output.tools'
  | 'output.usage'
  | 'health.liveness'
  | 'health.readiness';

export type RuntimeAdapterLifecycleState =
  | 'created'
  | 'connecting'
  | 'connected'
  | 'closing'
  | 'closed';

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
  checks?: readonly RuntimeHealthCheck[];
};

export type RuntimeHealthCheck = {
  name: string;
  status: 'healthy' | 'degraded' | 'unavailable';
  kind: 'transport' | 'liveness' | 'readiness' | 'authentication' | 'component';
  message?: string;
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
  applicationSessionId: ApplicationSessionId;
  title?: string;
  metadata?: Readonly<Record<string, string>>;
  providerState?: Readonly<Record<string, unknown>>;
};

export type RuntimeSession = {
  applicationSessionId: ApplicationSessionId;
  externalSessionId: ExternalSessionId;
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
      /** Declared bytes; adapters also validate inline data.byteLength. */
      byteSize?: number;
      data: Uint8Array;
    }
  | {
      kind: 'file';
      mimeType: string;
      name: string;
      /** Declared bytes for referenced or inline content. */
      byteSize?: number;
      data?: Uint8Array;
      uri?: string;
    };

export type StartRuntimeRunInput = {
  applicationRunId: ApplicationRunId;
  idempotencyKey: RuntimeIdempotencyKey;
  session: RuntimeSession;
  input: RuntimeUserInput;
  instructions?: string;
  history?: RuntimeMessage[];
  timeoutMs?: number;
  metadata?: Readonly<Record<string, string>>;
};

export type RuntimeRunHandle = {
  applicationRunId: ApplicationRunId;
  externalRunId: ExternalRunId;
  status: RuntimeRunStatus;
  sessionStatePatch?: RuntimeSessionStatePatch;
  providerState?: Readonly<Record<string, unknown>>;
};

export type RuntimeSessionStatePatch = {
  previousResponseId?: string;
  externalSessionId?: ExternalSessionId;
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
  applicationRunId: ApplicationRunId;
  externalRunId: ExternalRunId;
  externalSessionId: ExternalSessionId;
  cursor?: string;
  providerState?: Readonly<Record<string, unknown>>;
};

export type GetRuntimeRunInput = {
  applicationRunId: ApplicationRunId;
  externalRunId: ExternalRunId;
  externalSessionId?: ExternalSessionId;
  providerState?: Readonly<Record<string, unknown>>;
};

export type CancelRuntimeRunInput = GetRuntimeRunInput;

export type RuntimeApprovalDecision =
  | {
      action: 'allow';
      scope: 'once' | 'session' | 'always';
    }
  | {
      action: 'deny';
    };

export type ResolveRuntimeApprovalInput = {
  applicationRunId: ApplicationRunId;
  externalRunId: ExternalRunId;
  approvalId: RuntimeApprovalId;
  decision: RuntimeApprovalDecision;
  comment?: string;
};

export type GetRuntimeHistoryInput = {
  applicationSessionId: ApplicationSessionId;
  externalSessionId: ExternalSessionId;
  limit?: number;
  cursor?: string;
  providerState?: Readonly<Record<string, unknown>>;
};

export type RuntimeRunSnapshot = {
  applicationRunId: ApplicationRunId;
  externalRunId: ExternalRunId;
  status: RuntimeRunStatus;
  output?: RuntimeRunOutput;
  usage?: RuntimeUsage;
  sessionStatePatch?: RuntimeSessionStatePatch;
  error?: RuntimeRunFailure;
  providerState?: Readonly<Record<string, unknown>>;
};

export type RuntimeUsage = Readonly<Record<string, number>>;

/** Normalized text output for the alpha Runs contract. */
export type RuntimeRunOutput = string;

export type RuntimeRunFailure = {
  code: RuntimeErrorCode;
  message: string;
  retryable: boolean;
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

export type RuntimeHistoryMessage = RuntimeMessage;

export type RuntimeHistoryPage = {
  messages: readonly RuntimeHistoryMessage[];
  nextCursor?: string;
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
  | 'approval.required'
  | 'approval.resolved'
  | 'usage.updated'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled'
  | 'transport.warning'
  | 'transport.gap';

export type RuntimeEventBase = {
  schemaVersion: 1;
  eventId: NormalizedEventId;
  sequence?: number;
  occurredAt: string;
  applicationRunId: ApplicationRunId;
  externalRunId: ExternalRunId;
  externalSessionId: ExternalSessionId;
  provider?: {
    adapterId: string;
    eventName?: string;
    providerEventId?: ProviderEventId;
    /** Sanitized, bounded, opt-in data. Shape is unstable across alpha releases. */
    sanitizedRawPayload?: unknown;
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
export type ApprovalRequiredEvent = RuntimeEventBase & {
  type: 'approval.required';
  approvalId: string;
  description: string;
  availableDecisions: readonly RuntimeApprovalDecision[];
  toolName?: string;
  expiresAt?: string;
  sanitizedArgumentPreview?: unknown;
};

export type RuntimeApprovalRequest = Pick<
  ApprovalRequiredEvent,
  | 'approvalId'
  | 'applicationRunId'
  | 'externalRunId'
  | 'description'
  | 'availableDecisions'
  | 'toolName'
  | 'expiresAt'
  | 'sanitizedArgumentPreview'
>;

export type RuntimeApprovalResolution = {
  approvalId: string;
  applicationRunId: string;
  externalRunId: string;
  decision: RuntimeApprovalDecision;
  resolvedAt: string;
};
export type ApprovalResolvedEvent = RuntimeEventBase & {
  type: 'approval.resolved';
  approvalId: string;
  decision: RuntimeApprovalDecision;
};
export type UsageUpdatedEvent = RuntimeEventBase & {
  type: 'usage.updated';
  usage: Readonly<Record<string, number>>;
};
export type RunCompletedEvent = RuntimeEventBase & {
  type: 'run.completed';
  output?: string;
  usage?: Readonly<Record<string, number>>;
  sessionStatePatch?: RuntimeSessionStatePatch;
};
export type RunFailedEvent = RuntimeEventBase & {
  type: 'run.failed';
  error: {
    code: RuntimeErrorCode;
    message: string;
    retryable: boolean;
  };
  sessionStatePatch?: RuntimeSessionStatePatch;
};
export type RunCancelledEvent = RuntimeEventBase & {
  type: 'run.cancelled';
  sessionStatePatch?: RuntimeSessionStatePatch;
};
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
  | ApprovalRequiredEvent
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
  | 'PERMISSION_DENIED'
  | 'PAIRING_REQUIRED'
  | 'PROTOCOL_MISMATCH'
  | 'UNSUPPORTED_CAPABILITY'
  | 'INVALID_CONFIGURATION'
  | 'INVALID_REQUEST'
  | 'INVALID_RESPONSE'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PROVIDER_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'CANCELLED'
  | 'PROVIDER_ERROR'
  | 'OUTCOME_UNKNOWN'
  | 'NETWORK_POLICY_REJECTED'
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
