/** Public alpha contract for application session id. */
export type ApplicationSessionId = string;
/** Public alpha contract for external session id. */
export type ExternalSessionId = string;
/** Public alpha contract for application run id. */
export type ApplicationRunId = string;
/** Public alpha contract for external run id. */
export type ExternalRunId = string;
/** Public alpha contract for normalized event id. */
export type NormalizedEventId = string;
/** Public alpha contract for provider event id. */
export type ProviderEventId = string;
/** Public alpha contract for runtime approval id. */
export type RuntimeApprovalId = string;
/** Public alpha contract for runtime idempotency key. */
export type RuntimeIdempotencyKey = string;
/** Public alpha contract for runtime endpoint fingerprint. */
export type RuntimeEndpointFingerprint = string;
/** Public alpha contract for runtime credential reference. */
export type RuntimeCredentialReference = string;

/** Public alpha contract for runtime target. */
export type RuntimeTarget = {
  /** Absolute runtime endpoint. Strings are normalized and validated before network use. */
  endpoint: string;
  authHint?: 'bearer' | 'token' | 'password' | 'device' | 'none';
  adapterHint?: string;
  transportHint?: 'websocket' | 'http' | 'stdio';
  metadata?: Readonly<Record<string, string>>;
};

/** Public alpha contract for runtime connection config. */
export type RuntimeConnectionConfig = {
  target: RuntimeTarget;
  credentialRef?: RuntimeCredentialReference;
  auth?: RuntimeAuthInput;
  requestedCapabilities?: RuntimeCapabilityName[];
  options?: Readonly<Record<string, unknown>>;
};

/** Public alpha contract for runtime descriptor. */
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

/** Public alpha contract for runtime capabilities. */
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
  /** Optional because adapters that do not expose scheduling need not implement it. */
  schedules?: {
    create: boolean;
    get: boolean;
    list: boolean;
    update: boolean;
    delete: boolean;
    enable: boolean;
    pause: boolean;
    trigger: boolean;
    history: boolean;
  };
  extensions: RuntimeCapabilityExtensions;
};

/** Provider extensions are namespaced and remain outside the common model. */
export type RuntimeCapabilityExtensionValue = boolean | string | number;
/** Public alpha contract for runtime capability extensions. */
export type RuntimeCapabilityExtensions = Readonly<
  Record<`${string}.${string}`, RuntimeCapabilityExtensionValue>
>;

/** Public alpha contract for runtime capability name. */
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
  | 'health.readiness'
  | 'schedules.create'
  | 'schedules.get'
  | 'schedules.list'
  | 'schedules.update'
  | 'schedules.delete'
  | 'schedules.enable'
  | 'schedules.pause'
  | 'schedules.trigger'
  | 'schedules.history';

/** Public alpha contract for runtime schedule id. */
export type ExternalScheduleId = string;

/** Provider-neutral schedule timing. */
export type RuntimeScheduleTiming =
  | { kind: 'once'; at: string }
  | { kind: 'interval'; everyMs: number; startsAt?: string }
  | { kind: 'cron'; expression: string; timezone?: string };

/** Provider-neutral schedule payload. */
export type RuntimeSchedulePayload = {
  text: string;
  kind?: 'agent-turn' | 'system-event';
  sessionTarget?: string;
  deliveryChannel?: string;
};

/** Public alpha contract for schedule create input. */
export type CreateRuntimeScheduleInput = {
  idempotencyKey: RuntimeIdempotencyKey;
  name?: string;
  timing: RuntimeScheduleTiming;
  payload: RuntimeSchedulePayload;
  enabled?: boolean;
  metadata?: Readonly<Record<string, string>>;
};

/** Public alpha contract for schedule update input. */
export type UpdateRuntimeScheduleInput = {
  externalScheduleId: ExternalScheduleId;
  name?: string;
  timing?: RuntimeScheduleTiming;
  payload?: RuntimeSchedulePayload;
  enabled?: boolean;
};

/** Public alpha contract for schedule lookup input. */
export type GetRuntimeScheduleInput = { externalScheduleId: ExternalScheduleId };
/** Public alpha contract for schedule list input. */
export type ListRuntimeSchedulesInput = { limit?: number; cursor?: string };

/** Normalized runtime schedule. */
export type RuntimeSchedule = {
  externalScheduleId: ExternalScheduleId;
  name?: string;
  timing: RuntimeScheduleTiming;
  payload: RuntimeSchedulePayload;
  status: 'enabled' | 'disabled' | 'paused' | 'completed' | 'failed' | 'unknown';
  nextExecutionAt?: string;
  previousExecutionAt?: string;
  idempotencyKey?: string;
};

/** Normalized runtime schedule page. */
export type RuntimeSchedulePage = { schedules: readonly RuntimeSchedule[]; nextCursor?: string };

/** Normalized schedule execution. */
export type RuntimeScheduleExecution = {
  externalScheduleId: ExternalScheduleId;
  executionId?: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown';
  scheduledAt?: string;
  startedAt?: string;
  completedAt?: string;
};

/** Normalized schedule execution page. */
export type RuntimeScheduleExecutionPage = { executions: readonly RuntimeScheduleExecution[]; nextCursor?: string };

/** Public alpha contract for runtime adapter lifecycle state. */
export type RuntimeAdapterLifecycleState =
  | 'created'
  | 'connecting'
  | 'connected'
  | 'closing'
  | 'closed';

/** Public alpha contract for runtime auth input. */
export type RuntimeAuthInput =
  | { kind: 'bearer'; token: string }
  | { kind: 'token'; token: string }
  | { kind: 'password'; password: string; username?: string }
  | { kind: 'device-token'; token: string; deviceId?: string }
  | { kind: 'none' };

/** Public alpha contract for operation options. */
export type OperationOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  traceId?: string;
};

/** Public alpha contract for probe options. */
export type ProbeOptions = OperationOptions & {
  allowAuthentication?: boolean;
};

/** Public alpha contract for connect options. */
export type ConnectOptions = OperationOptions & {
  forceReconnect?: boolean;
};

/** Public alpha contract for runtime connection info. */
export type RuntimeConnectionInfo = {
  descriptor: RuntimeDescriptor;
  connectedAt: string;
  connectionId?: string;
  warnings: string[];
};

/** Public alpha contract for runtime health. */
export type RuntimeHealth = {
  status: 'healthy' | 'degraded' | 'unavailable';
  checkedAt: string;
  latencyMs?: number;
  descriptor?: RuntimeDescriptor;
  warnings: string[];
  checks?: readonly RuntimeHealthCheck[];
};

/** Public alpha contract for runtime health check. */
export type RuntimeHealthCheck = {
  name: string;
  status: 'healthy' | 'degraded' | 'unavailable';
  kind: 'transport' | 'liveness' | 'readiness' | 'authentication' | 'component';
  message?: string;
};

/** Public alpha contract for runtime probe result. */
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

/** Public alpha contract for ensure session input. */
export type EnsureSessionInput = {
  applicationSessionId: ApplicationSessionId;
  title?: string;
  metadata?: Readonly<Record<string, string>>;
  providerState?: Readonly<Record<string, unknown>>;
};

/** Public alpha contract for runtime session. */
export type RuntimeSession = {
  applicationSessionId: ApplicationSessionId;
  externalSessionId: ExternalSessionId;
  providerState?: Readonly<Record<string, unknown>>;
  created: boolean;
};

/** Public alpha contract for runtime user input. */
export type RuntimeUserInput = {
  text: string;
  attachments?: RuntimeAttachment[];
};

/** Public alpha contract for runtime attachment. */
export type RuntimeAttachment =
  | {
      kind: 'image';
      mimeType: string;
      name?: string;
      /** Declared bytes; adapters also validate inline data.byteLength. */
      byteSize?: number;
      contentHash?: string;
      consumerReference?: string;
      data: Uint8Array;
    }
  | {
      kind: 'file';
      mimeType: string;
      name: string;
      /** Declared bytes for referenced or inline content. */
      byteSize?: number;
      contentHash?: string;
      consumerReference?: string;
      data: Uint8Array;
    };

/** Public alpha contract for start runtime run input. */
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

/** Public alpha contract for runtime run handle. */
export type RuntimeRunHandle = {
  applicationRunId: ApplicationRunId;
  externalRunId: ExternalRunId;
  status: RuntimeRunStatus;
  sessionStatePatch?: RuntimeSessionStatePatch;
  providerState?: Readonly<Record<string, unknown>>;
};

/** Public alpha contract for runtime session state patch. */
export type RuntimeSessionStatePatch = {
  previousResponseId?: string;
  externalSessionId?: ExternalSessionId;
  providerState?: Readonly<Record<string, unknown>>;
};

/** Public alpha contract for runtime run status. */
export type RuntimeRunStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_approval'
  | 'stopping'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'unknown';

/** Public alpha contract for stream runtime run input. */
export type StreamRuntimeRunInput = {
  applicationRunId: ApplicationRunId;
  externalRunId: ExternalRunId;
  externalSessionId: ExternalSessionId;
  cursor?: string;
  providerState?: Readonly<Record<string, unknown>>;
};

/** Public alpha contract for get runtime run input. */
export type GetRuntimeRunInput = {
  applicationRunId: ApplicationRunId;
  externalRunId: ExternalRunId;
  externalSessionId?: ExternalSessionId;
  providerState?: Readonly<Record<string, unknown>>;
};

/** Public alpha contract for cancel runtime run input. */
export type CancelRuntimeRunInput = GetRuntimeRunInput;

/** Public alpha contract for runtime approval decision. */
export type RuntimeApprovalDecision =
  | {
      action: 'allow';
      scope: 'once' | 'session' | 'always';
    }
  | {
      action: 'deny';
    };

/** Public alpha contract for resolve runtime approval input. */
export type ResolveRuntimeApprovalInput = {
  applicationRunId: ApplicationRunId;
  externalRunId: ExternalRunId;
  approvalId: RuntimeApprovalId;
  decision: RuntimeApprovalDecision;
  comment?: string;
};

/** Public alpha contract for get runtime history input. */
export type GetRuntimeHistoryInput = {
  applicationSessionId: ApplicationSessionId;
  externalSessionId: ExternalSessionId;
  limit?: number;
  cursor?: string;
  providerState?: Readonly<Record<string, unknown>>;
};

/** Public alpha contract for runtime run snapshot. */
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

/** Public alpha contract for runtime usage. */
export type RuntimeUsage = Readonly<Record<string, number>>;

/** Normalized text output for the alpha Runs contract. */
export type RuntimeRunOutput = string;

/** Public alpha contract for runtime run failure. */
export type RuntimeRunFailure = {
  code: RuntimeErrorCode;
  message: string;
  retryable: boolean;
};

/** Public alpha contract for runtime message. */
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

/** Public alpha contract for runtime history message. */
export type RuntimeHistoryMessage = RuntimeMessage;

/** Public alpha contract for runtime history page. */
export type RuntimeHistoryPage = {
  messages: readonly RuntimeHistoryMessage[];
  nextCursor?: string;
};

/** Public alpha contract for runtime event name. */
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

/** Public alpha contract for runtime event base. */
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

/** Public alpha contract for runtime queued event. */
export type RuntimeQueuedEvent = RuntimeEventBase & { type: 'run.queued' };
/** Public alpha contract for runtime started event. */
export type RuntimeStartedEvent = RuntimeEventBase & { type: 'run.started' };
/** Public alpha contract for assistant delta event. */
export type AssistantDeltaEvent = RuntimeEventBase & {
  type: 'assistant.delta';
  delta: string;
};
/** Public alpha contract for assistant completed event. */
export type AssistantCompletedEvent = RuntimeEventBase & {
  type: 'assistant.completed';
  text: string;
};
/** Public alpha contract for reasoning delta event. */
export type ReasoningDeltaEvent = RuntimeEventBase & {
  type: 'reasoning.delta';
  delta: string;
};
/** Public alpha contract for tool started event. */
export type ToolStartedEvent = RuntimeEventBase & {
  type: 'tool.started';
  toolCallId: string;
  name?: string;
};
/** Public alpha contract for tool updated event. */
export type ToolUpdatedEvent = RuntimeEventBase & {
  type: 'tool.updated';
  toolCallId: string;
  status?: string;
};
/** Public alpha contract for tool completed event. */
export type ToolCompletedEvent = RuntimeEventBase & {
  type: 'tool.completed';
  toolCallId: string;
  result?: unknown;
};
/** Public alpha contract for approval required event. */
export type ApprovalRequiredEvent = RuntimeEventBase & {
  type: 'approval.required';
  approvalId: string;
  description: string;
  availableDecisions: readonly RuntimeApprovalDecision[];
  toolName?: string;
  expiresAt?: string;
  sanitizedArgumentPreview?: unknown;
};

/** Public alpha contract for runtime approval request. */
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

/** Public alpha contract for runtime approval resolution. */
export type RuntimeApprovalResolution = {
  approvalId: string;
  applicationRunId: string;
  externalRunId: string;
  decision: RuntimeApprovalDecision;
  resolvedAt: string;
};
/** Public alpha contract for approval resolved event. */
export type ApprovalResolvedEvent = RuntimeEventBase & {
  type: 'approval.resolved';
  approvalId: string;
  decision: RuntimeApprovalDecision;
};
/** Public alpha contract for usage updated event. */
export type UsageUpdatedEvent = RuntimeEventBase & {
  type: 'usage.updated';
  usage: Readonly<Record<string, number>>;
};
/** Public alpha contract for run completed event. */
export type RunCompletedEvent = RuntimeEventBase & {
  type: 'run.completed';
  output?: string;
  usage?: Readonly<Record<string, number>>;
  sessionStatePatch?: RuntimeSessionStatePatch;
};
/** Public alpha contract for run failed event. */
export type RunFailedEvent = RuntimeEventBase & {
  type: 'run.failed';
  error: {
    code: RuntimeErrorCode;
    message: string;
    retryable: boolean;
  };
  sessionStatePatch?: RuntimeSessionStatePatch;
};
/** Public alpha contract for run cancelled event. */
export type RunCancelledEvent = RuntimeEventBase & {
  type: 'run.cancelled';
  sessionStatePatch?: RuntimeSessionStatePatch;
};
/** Public alpha contract for transport warning event. */
export type TransportWarningEvent = RuntimeEventBase & {
  type: 'transport.warning';
  warning: string;
};
/** Public alpha contract for transport gap event. */
export type TransportGapEvent = RuntimeEventBase & {
  type: 'transport.gap';
  expected?: number;
  actual?: number;
};

/** Public alpha contract for runtime event. */
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

/** Public alpha contract for runtime error code. */
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

/** Public alpha contract for runtime http request. */
export type RuntimeHttpRequest = {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  headers?: Readonly<Record<string, string>>;
  body?: string | Uint8Array;
  signal?: AbortSignal;
};

/** Public alpha contract for runtime http response. */
export type RuntimeHttpResponse = {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: AsyncIterable<Uint8Array>;
};

/** Public alpha contract for runtime web socket event. */
export type RuntimeWebSocketEvent =
  | { type: 'open' }
  | { type: 'message'; data: string | Uint8Array }
  | { type: 'error'; error: unknown }
  | { type: 'close'; code?: number; reason?: string };

/** Public alpha contract for runtime secret. */
export type RuntimeSecret = {
  value: string | Uint8Array;
  contentType?: string;
  expiresAt?: string;
};
