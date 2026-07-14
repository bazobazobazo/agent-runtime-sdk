# Public API Snapshot

Generated from package declaration files. Review diffs before release.

## @banzae/agent-runtime-hermes

### dedupe.d.ts

```ts
export declare class BoundedDedupeWindow {
    readonly capacity: number;
    private readonly values;
    private readonly order;
    constructor(capacity: number);
    get size(): number;
    seen(key: string): boolean;
    clear(): void;
}
```

### extensions.d.ts

```ts
import type { RuntimeApprovalDecision, RuntimeMessage } from '@banzae/agent-runtime-core';
export interface RuntimeApprovalCapability {
    resolveApproval(input: {
        externalRunId: string;
        approvalId: string;
        decision: RuntimeApprovalDecision;
        comment?: string;
    }): Promise<void>;
}
export interface HermesSessionsExtension {
    list(input?: {
        limit?: number;
        offset?: number;
    }): Promise<unknown>;
    create(input?: {
        title?: string;
    }): Promise<{
        id: string;
    }>;
    get(id: string): Promise<unknown>;
    messages(id: string): Promise<RuntimeMessage[]>;
    fork(id: string, input?: {
        title?: string;
    }): Promise<{
        id: string;
    }>;
    delete(id: string): Promise<void>;
}
export interface HermesJobsExtension {
    list(): Promise<unknown[]>;
    create(input: unknown): Promise<unknown>;
    update(id: string, patch: unknown): Promise<unknown>;
    remove(id: string): Promise<void>;
    pause(id: string): Promise<void>;
    resume(id: string): Promise<void>;
    runNow(id: string): Promise<unknown>;
}
```

### hermes-adapter.d.ts

```ts
import { type AgentRuntimeAdapter, type CancelRuntimeRunInput, type ConnectOptions, type EnsureSessionInput, type GetRuntimeHistoryInput, type GetRuntimeRunInput, type OperationOptions, type ProbeOptions, type ResolveRuntimeApprovalInput, type RuntimeAdapterDependencies, type RuntimeCapabilities, type RuntimeConnectionConfig, type RuntimeConnectionInfo, type RuntimeEvent, type RuntimeHealth, type RuntimeMessage, type RuntimeProbeResult, type RuntimeRunHandle, type RuntimeRunSnapshot, type RuntimeSession, type RuntimeTarget, type StartRuntimeRunInput, type StreamRuntimeRunInput } from '@banzae/agent-runtime-core';
export type HermesSessionMode = 'auto' | 'client-scoped' | 'rest-session';
export type HermesAdapterOptions = {
    baseUrl?: string;
    bearerToken?: string;
    bearerTokenRef?: string;
    model?: string;
    requestTimeoutMs?: number;
    runTimeoutMs?: number;
    sessionMode?: HermesSessionMode;
    sessionKeyHeader?: string;
    sessionIdHeader?: string;
    historyMode?: 'previous_response_id' | 'conversation_history' | 'hybrid';
    includeRawProviderPayload?: boolean;
    maxReconnectAttempts?: number;
    reconnectDelayMs?: number;
    pollingIntervalMs?: number;
    maxReconciliationMs?: number;
    maxDeduplicationEntries?: number;
};
export declare class HermesAdapter implements AgentRuntimeAdapter {
    private readonly deps;
    private readonly options;
    readonly adapterId = "hermes";
    readonly adapterVersion = "0.1.0";
    private connected?;
    private closed;
    private closing?;
    private readonly activeStreams;
    private readonly approvals;
    constructor(deps: RuntimeAdapterDependencies, options?: HermesAdapterOptions);
    probe(target: RuntimeTarget, options?: ProbeOptions): Promise<RuntimeProbeResult>;
    connect(config: RuntimeConnectionConfig, options?: ConnectOptions): Promise<RuntimeConnectionInfo>;
    health(options?: OperationOptions): Promise<RuntimeHealth>;
    capabilities(): Promise<RuntimeCapabilities>;
    ensureSession(input: EnsureSessionInput, options?: OperationOptions): Promise<RuntimeSession>;
    startRun(input: StartRuntimeRunInput, options?: OperationOptions): Promise<RuntimeRunHandle>;
    streamRun(input: StreamRuntimeRunInput, options?: OperationOptions): AsyncIterable<RuntimeEvent>;
    private iterateRunStream;
    getRun(input: GetRuntimeRunInput, options?: OperationOptions): Promise<RuntimeRunSnapshot>;
    cancelRun(input: CancelRuntimeRunInput, options?: OperationOptions): Promise<void>;
    resolveApproval(input: ResolveRuntimeApprovalInput, options?: OperationOptions): Promise<void>;
    getHistory(input: GetRuntimeHistoryInput, options?: OperationOptions): Promise<RuntimeMessage[]>;
    close(): Promise<void>;
    private descriptor;
    private eventContext;
    private delayWithinDeadline;
    private clearRunApprovals;
    private closeResources;
    private requireConnected;
}
export declare function createHermesAdapterFactory(options?: HermesAdapterOptions): {
    adapterId: string;
    create: (dependencies: RuntimeAdapterDependencies) => HermesAdapter;
};
```

### http/client.d.ts

```ts
import { type RuntimeHttpTransport } from '@banzae/agent-runtime-core';
export type HermesHttpClientOptions = {
    baseUrl: string;
    bearerToken?: string;
    requestTimeoutMs?: number;
    maxBodyBytes?: number;
    maxHeaderBytes?: number;
};
export type HermesHttpInput = {
    body?: unknown;
    idempotencyKey?: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
    timeoutMs?: number;
    allowEmpty?: boolean;
};
export declare class HermesHttpClient {
    private readonly transport;
    private readonly options;
    private readonly baseUrl;
    private closed;
    private readonly active;
    constructor(transport: RuntimeHttpTransport, options: HermesHttpClientOptions);
    get hasCredentials(): boolean;
    json<T>(method: 'GET' | 'POST', path: string, input?: HermesHttpInput): Promise<{
        value: T;
        headers: Readonly<Record<string, string>>;
        status: number;
    }>;
    stream(path: string, input?: HermesHttpInput): Promise<AsyncIterable<Uint8Array>>;
    close(): Promise<void>;
    private assertOpen;
    private url;
    private headers;
    private httpError;
}
```

### index.d.ts

```ts
export * from './extensions.js';
export * from './hermes-adapter.js';
export * from './http/client.js';
export * from './mapping/capabilities.js';
export * from './mapping/events.js';
export * from './sse/parser.js';
```

### mapping/capabilities.d.ts

```ts
import { type RuntimeCapabilities } from '@banzae/agent-runtime-core';
export type ValidatedHermesCapabilities = {
    value: Record<string, unknown>;
    features: Record<string, unknown>;
    endpoints: Record<string, unknown>;
};
export declare function validateHermesCapabilities(payload: unknown): ValidatedHermesCapabilities;
export declare function mapHermesCapabilities(payload: unknown): RuntimeCapabilities;
export declare function isHermesCapabilities(payload: unknown): boolean;
```

### mapping/events.d.ts

```ts
import { type RuntimeAdapterDependencies, type RuntimeApprovalDecision, type RuntimeEvent } from '@banzae/agent-runtime-core';
import { type HermesApprovalChoice } from '../schemas.js';
export type HermesEventContext = {
    ids: RuntimeAdapterDependencies['ids'];
    clock: RuntimeAdapterDependencies['clock'];
    applicationRunId: string;
    externalRunId: string;
    externalSessionId: string;
    includeRawProviderPayload?: boolean;
    pendingApprovalIds?: string[];
    pendingToolIds?: Map<string, string[]>;
};
export declare function mapHermesSseEvent(eventName: string | undefined, data: unknown, context: HermesEventContext): RuntimeEvent[];
export declare function parseHermesEventData(data: string): unknown;
export declare function toHermesChoice(decision: RuntimeApprovalDecision): HermesApprovalChoice;
export declare function fromHermesChoice(choice: HermesApprovalChoice): RuntimeApprovalDecision;
```

### schemas.d.ts

```ts
import { type RuntimeMessage, type RuntimeRunStatus } from '@banzae/agent-runtime-core';
export type HermesRunCreate = {
    runId: string;
    status: 'started';
};
export type HermesRunStatus = {
    value: Record<string, unknown>;
    runId: string;
    status: RuntimeRunStatus;
    output?: string;
    usage?: Readonly<Record<string, number>>;
    sessionId?: string;
    error?: {
        code: string;
    };
};
export type HermesApprovalChoice = 'once' | 'session' | 'always' | 'deny';
export declare function validateHealth(value: unknown): {
    status: 'ok';
    platform: 'hermes-agent';
    version: string;
};
export declare function validateDetailedHealth(value: unknown): {
    status: string;
    platform: 'hermes-agent';
    version: string;
};
export declare function validateRunCreateResponse(value: unknown): HermesRunCreate;
export declare function validateRunStatusResponse(value: unknown): HermesRunStatus;
export declare function validateUsage(value: unknown): Readonly<Record<string, number>>;
export declare function validateRunFailure(value: unknown): {
    code: string;
};
export declare function validateStopResponse(value: unknown, externalRunId: string): void;
export declare function validateApprovalRequest(value: unknown): {
    runId: string;
    choices: HermesApprovalChoice[];
    description: string;
};
export declare function validateApprovalResponse(value: unknown, externalRunId: string, choice: HermesApprovalChoice): void;
export declare function validateSessionCreateResponse(value: unknown): {
    sessionId: string;
};
export declare function validateSessionMessagesResponse(value: unknown, externalSessionId: string): {
    messages: RuntimeMessage[];
};
export declare function validateTerminalEvent(value: unknown, expectedEvent: 'run.completed' | 'run.failed' | 'run.cancelled'): Record<string, unknown>;
export declare function normalizeStatus(status: string): RuntimeRunStatus;
```

### sse/parser.d.ts

```ts
export type SseEvent = {
    id?: string;
    event?: string;
    data: string;
};
export type SseParserOptions = {
    signal?: AbortSignal;
    maxLineBytes?: number;
    maxEventBytes?: number;
    maxPendingBytes?: number;
};
export declare function parseSseStream(body: AsyncIterable<Uint8Array>, optionsOrMaxEventBytes?: SseParserOptions | number): AsyncIterable<SseEvent>;
```

## @banzae/agent-runtime-openclaw

### extensions.d.ts

```ts
export type OpenClawCronJob = {
    id: string;
    spec?: string;
    enabled?: boolean;
    raw?: unknown;
};
export type OpenClawCronAddInput = {
    name: string;
    schedule: string;
    instruction: string;
    timezone?: string;
    metadata?: Record<string, string>;
};
export interface OpenClawCronExtension {
    status(): Promise<unknown>;
    add(input: OpenClawCronAddInput): Promise<OpenClawCronJob>;
    remove(jobId: string): Promise<void>;
    list(): Promise<OpenClawCronJob[]>;
    runs(jobId?: string): Promise<unknown[]>;
}
```

### index.d.ts

```ts
export * from './extensions.js';
export * from './mapping/transcript.js';
export * from './openclaw-adapter.js';
export * from './protocol/registry.js';
export * from './protocol/types.js';
export * from './protocol/v3/codec.js';
export * from './protocol/v4/codec.js';
export * from './transport/request-manager.js';
```

### mapping/transcript.d.ts

```ts
import type { RuntimeMessage } from '@banzae/agent-runtime-core';
export declare function normalizeOpenClawHistory(payload: unknown): RuntimeMessage[];
```

### openclaw-adapter.d.ts

```ts
import { type AgentRuntimeAdapter, type CancelRuntimeRunInput, type ConnectOptions, type EnsureSessionInput, type GetRuntimeHistoryInput, type GetRuntimeRunInput, type OperationOptions, type ProbeOptions, type RuntimeAdapterDependencies, type RuntimeCapabilities, type RuntimeConnectionConfig, type RuntimeConnectionInfo, type RuntimeEvent, type RuntimeHealth, type RuntimeMessage, type RuntimeProbeResult, type RuntimeRunHandle, type RuntimeRunSnapshot, type RuntimeSession, type RuntimeTarget, type StartRuntimeRunInput, type StreamRuntimeRunInput } from '@banzae/agent-runtime-core';
import type { OpenClawProtocolCodec } from './protocol/types.js';
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
export declare class OpenClawAdapter implements AgentRuntimeAdapter {
    private readonly deps;
    private readonly options;
    readonly adapterId = "openclaw";
    readonly adapterVersion = "0.1.0";
    private readonly registry;
    private connected?;
    private target?;
    constructor(deps: RuntimeAdapterDependencies, options?: OpenClawAdapterOptions);
    probe(target: RuntimeTarget, options?: ProbeOptions): Promise<RuntimeProbeResult>;
    connect(config: RuntimeConnectionConfig, options?: ConnectOptions): Promise<RuntimeConnectionInfo>;
    health(): Promise<RuntimeHealth>;
    capabilities(): Promise<RuntimeCapabilities>;
    ensureSession(input: EnsureSessionInput, options?: OperationOptions): Promise<RuntimeSession>;
    startRun(input: StartRuntimeRunInput, options?: OperationOptions): Promise<RuntimeRunHandle>;
    streamRun(input: StreamRuntimeRunInput): AsyncIterable<RuntimeEvent>;
    getRun(input: GetRuntimeRunInput, options?: OperationOptions): Promise<RuntimeRunSnapshot>;
    cancelRun(input: CancelRuntimeRunInput, options?: OperationOptions): Promise<void>;
    getHistory(input: GetRuntimeHistoryInput, options?: OperationOptions): Promise<RuntimeMessage[]>;
    close(): Promise<void>;
    private connectWithCodec;
    private descriptor;
    private requireConnected;
    private mapRunStartTransportError;
    private buildSignedDeviceProof;
    private getOrCreateDeviceIdentity;
    private getStoredDeviceIdentity;
    private resolveDeviceIdentity;
    private getStoredDeviceToken;
    private saveReturnedDeviceToken;
    private deviceTokenStateKey;
}
export declare function createOpenClawAdapterFactory(options?: OpenClawAdapterOptions): {
    adapterId: string;
    create: (dependencies: RuntimeAdapterDependencies) => OpenClawAdapter;
};
```

### protocol/negotiation.d.ts

```ts
import type { RuntimeError } from '@banzae/agent-runtime-core';
export type OpenClawNegotiationDecision = 'try-next-protocol' | 'fail-closed';
export declare function classifyNegotiationFailure(error: RuntimeError): OpenClawNegotiationDecision;
```

### protocol/registry.d.ts

```ts
import type { OpenClawProtocolCodec } from './types.js';
export declare const OPENCLAW_SUPPORTED_PROTOCOLS: readonly [{
    readonly protocolName: "openclaw-gateway-v4";
    readonly protocolVersion: 4;
    readonly status: "supported";
}, {
    readonly protocolName: "openclaw-gateway-v3";
    readonly protocolVersion: 3;
    readonly status: "supported";
}];
export declare class OpenClawProtocolRegistry {
    private readonly codecs;
    register(codec: OpenClawProtocolCodec): void;
    supportedVersions(): number[];
    preferredVersions(): number[];
    get(version: number): OpenClawProtocolCodec | undefined;
    require(version: number): OpenClawProtocolCodec;
}
```

### protocol/shared.d.ts

```ts
export { MappedOpenClawCodec as BaseOpenClawCodec, type OpenClawProtocolMappings } from './shared/base-codec.js';
export { OPENCLAW_SANITIZER_VERSION, asRecord, booleanValue, numberValue, optionalRecord, protocolError, protocolMismatch, sanitizeOpenClawPayload, stringArray, stringValue, validTimestamp, } from './shared/validation.js';
```

### protocol/shared/base-codec.d.ts

```ts
import { RuntimeError, type CancelRuntimeRunInput, type EnsureSessionInput, type GetRuntimeHistoryInput, type GetRuntimeRunInput, type RuntimeCapabilities, type RuntimeEvent, type RuntimeRunSnapshot, type StartRuntimeRunInput } from '@banzae/agent-runtime-core';
import type { OpenClawCancelResult, OpenClawChallenge, OpenClawConnectInput, OpenClawFrame, OpenClawHello, OpenClawProviderEventMetadata, OpenClawProtocolCodec, OpenClawRpcRequest, OpenClawRunContext, OpenClawRunStartResult } from '../types.js';
export type OpenClawProtocolMappings = {
    connectEvent: string;
    connectMethod: string;
    sessionCreateMethod: string;
    runStartMethod: string;
    runWaitMethod: string;
    historyMethod: string;
    cancelMethod: string;
    deltaEvents: readonly string[];
    completedEvents: readonly string[];
    failedEvents: readonly string[];
    cancelledEvents: readonly string[];
    timeoutEvents: readonly string[];
    diagnosticEvents: readonly string[];
};
export declare abstract class MappedOpenClawCodec implements OpenClawProtocolCodec {
    abstract readonly protocolVersion: number;
    abstract readonly protocolName: `openclaw-gateway-v${number}`;
    protected abstract readonly mappings: OpenClawProtocolMappings;
    parseChallenge(frame: OpenClawFrame): OpenClawChallenge | undefined;
    createConnectParams(input: OpenClawConnectInput): Record<string, unknown>;
    parseHello(payload: unknown): OpenClawHello;
    parseFrame(input: string | Uint8Array): OpenClawFrame;
    encodeRequest(input: OpenClawRpcRequest): string;
    extractProviderEventMetadata(event: Extract<OpenClawFrame, {
        type: 'event';
    }>): OpenClawProviderEventMetadata;
    mapProviderEvent(event: Extract<OpenClawFrame, {
        type: 'event';
    }>, context: OpenClawRunContext): RuntimeEvent[];
    parseRunStartResponse(payload: unknown): OpenClawRunStartResult;
    parseRunWaitResponse(input: GetRuntimeRunInput, payload: unknown): RuntimeRunSnapshot;
    parseCancelResponse(payload: unknown): OpenClawCancelResult;
    mapError(error: unknown): RuntimeError;
    supportsMethod(method: string, hello: OpenClawHello): boolean;
    capabilities(hello?: OpenClawHello): RuntimeCapabilities;
    buildSessionCreate(input: EnsureSessionInput): OpenClawRpcRequest;
    buildRunStart(input: StartRuntimeRunInput): OpenClawRpcRequest;
    buildRunWait(input: GetRuntimeRunInput): OpenClawRpcRequest;
    buildHistory(input: GetRuntimeHistoryInput): OpenClawRpcRequest;
    buildCancel(input: CancelRuntimeRunInput): OpenClawRpcRequest;
}
```

### protocol/shared/validation.d.ts

```ts
import { RuntimeError } from '@banzae/agent-runtime-core';
export declare function asRecord(value: unknown, context?: string): Record<string, unknown>;
export declare function optionalRecord(value: unknown): Record<string, unknown>;
export declare function stringValue(value: unknown): string | undefined;
export declare function numberValue(value: unknown): number | undefined;
export declare function booleanValue(value: unknown): boolean | undefined;
export declare function stringArray(value: unknown): string[];
export declare function validTimestamp(value?: string): string | undefined;
export declare function protocolError(message: string, details?: Record<string, unknown>): RuntimeError;
export declare function protocolMismatch(message: string, details?: Record<string, unknown>): RuntimeError;
export declare const OPENCLAW_SANITIZER_VERSION = "openclaw-sanitizer-v2";
export declare function sanitizeOpenClawPayload(value: unknown): unknown;
```

### protocol/types.d.ts

```ts
import type { CancelRuntimeRunInput, EnsureSessionInput, GetRuntimeHistoryInput, GetRuntimeRunInput, RuntimeAdapterDependencies, RuntimeCapabilities, RuntimeEvent, RuntimeRunSnapshot, StartRuntimeRunInput } from '@banzae/agent-runtime-core';
import type { RuntimeError } from '@banzae/agent-runtime-core';
export type OpenClawFrame = {
    type: 'event';
    event: string;
    payload?: unknown;
    seq?: number;
    eventId?: string;
    timestamp?: string;
} | {
    type: 'req';
    id: string;
    method: string;
    params?: unknown;
} | {
    type: 'res';
    id: string;
    ok?: boolean;
    payload?: unknown;
    error?: unknown;
} | {
    type: 'hello-ok';
    [key: string]: unknown;
};
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
export type OpenClawChallenge = {
    nonce?: string;
    raw: unknown;
};
export type OpenClawRunStartResult = {
    externalRunId: string;
    status: RuntimeRunSnapshot['status'];
    providerState: Readonly<Record<string, unknown>>;
};
export type OpenClawCancelResult = {
    accepted: boolean;
    raw: unknown;
};
export type OpenClawProtocolFixtureMetadata = {
    runtimeProduct: 'openclaw';
    runtimeVersion: string;
    protocolVersion: number;
    captureDate: string;
    fixtureSchemaVersion: number;
    sanitizerVersion: string;
    source: 'synthetic' | 'sanitized-live-capture' | 'upstream-reference';
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
    parseChallenge(frame: OpenClawFrame): OpenClawChallenge | undefined;
    createConnectParams(input: OpenClawConnectInput): Record<string, unknown>;
    parseHello(payload: unknown): OpenClawHello;
    parseFrame(input: string | Uint8Array): OpenClawFrame;
    encodeRequest(input: OpenClawRpcRequest): string;
    extractProviderEventMetadata(event: Extract<OpenClawFrame, {
        type: 'event';
    }>): OpenClawProviderEventMetadata;
    mapProviderEvent(event: Extract<OpenClawFrame, {
        type: 'event';
    }>, context: OpenClawRunContext): RuntimeEvent[];
    parseRunStartResponse(payload: unknown): OpenClawRunStartResult;
    parseRunWaitResponse(input: GetRuntimeRunInput, payload: unknown): RuntimeRunSnapshot;
    parseCancelResponse(payload: unknown): OpenClawCancelResult;
    mapError(error: unknown): RuntimeError;
    supportsMethod(method: string, hello: OpenClawHello): boolean;
    capabilities(hello?: OpenClawHello): RuntimeCapabilities;
    buildSessionCreate(input: EnsureSessionInput): OpenClawRpcRequest;
    buildRunStart(input: StartRuntimeRunInput): OpenClawRpcRequest;
    buildRunWait(input: GetRuntimeRunInput): OpenClawRpcRequest;
    buildHistory(input: GetRuntimeHistoryInput): OpenClawRpcRequest;
    buildCancel(input: CancelRuntimeRunInput): OpenClawRpcRequest;
}
```

### protocol/v3/codec.d.ts

```ts
import { BaseOpenClawCodec } from '../shared.js';
export declare class OpenClawV3Codec extends BaseOpenClawCodec {
    readonly protocolVersion = 3;
    readonly protocolName: "openclaw-gateway-v3";
    protected readonly mappings: import("../shared.js").OpenClawProtocolMappings;
}
export declare function openClawV3Codec(): OpenClawV3Codec;
```

### protocol/v3/mappings.d.ts

```ts
import type { OpenClawProtocolMappings } from '../shared.js';
export declare const openClawV3Mappings: OpenClawProtocolMappings;
```

### protocol/v4/codec.d.ts

```ts
import { BaseOpenClawCodec } from '../shared.js';
export declare class OpenClawV4Codec extends BaseOpenClawCodec {
    readonly protocolVersion = 4;
    readonly protocolName: "openclaw-gateway-v4";
    protected readonly mappings: import("../shared.js").OpenClawProtocolMappings;
}
export declare function openClawV4Codec(): OpenClawV4Codec;
```

### protocol/v4/mappings.d.ts

```ts
import type { OpenClawProtocolMappings } from '../shared.js';
export declare const openClawV4Mappings: OpenClawProtocolMappings;
```

### transport/request-manager.d.ts

```ts
import { type RuntimeWebSocketConnection } from '@banzae/agent-runtime-core';
import type { OpenClawFrame, OpenClawProtocolCodec, OpenClawRpcRequest } from '../protocol/types.js';
export type OpenClawEventFilter = {
    event?: string;
    events?: readonly string[];
};
export type OpenClawRequestManagerOptions = {
    requestTimeoutMs: number;
    maxFrameBytes?: number;
    subscriberQueueSize?: number;
};
export declare class OpenClawRequestManager {
    private readonly connection;
    private readonly codec;
    private readonly pending;
    private readonly subscribers;
    private readonly maxFrameBytes;
    private readonly subscriberQueueSize;
    private readLoop?;
    private closePromise?;
    private closedError?;
    private subscriberSequence;
    constructor(connection: RuntimeWebSocketConnection, codec: OpenClawProtocolCodec, options: number | OpenClawRequestManagerOptions);
    /** Internal test instrumentation; not part of the exported package surface. */
    private get pendingRequestCount();
    /** Internal test instrumentation; not part of the exported package surface. */
    private get subscriberCount();
    private readonly options;
    start(): Promise<void>;
    request<T = unknown>(request: OpenClawRpcRequest, signal?: AbortSignal): Promise<T>;
    request<T = unknown>(request: OpenClawRpcRequest, options?: {
        signal?: AbortSignal;
        timeoutMs?: number;
    }): Promise<T>;
    subscribe(filter?: OpenClawEventFilter): AsyncIterable<Extract<OpenClawFrame, {
        type: 'event';
    }>>;
    close(): Promise<void>;
    private readEvents;
    private handleMessage;
    private publishEvent;
    private failAll;
    private cleanupPending;
    private removeSubscriber;
}
```

## @banzae/agent-runtime-core

### adapter.d.ts

```ts
import type { CancelRuntimeRunInput, ConnectOptions, EnsureSessionInput, GetRuntimeHistoryInput, GetRuntimeRunInput, OperationOptions, ProbeOptions, ResolveRuntimeApprovalInput, RuntimeCapabilities, RuntimeConnectionConfig, RuntimeConnectionInfo, RuntimeEvent, RuntimeHealth, RuntimeMessage, RuntimeProbeResult, RuntimeRunHandle, RuntimeRunSnapshot, RuntimeSession, RuntimeTarget, StartRuntimeRunInput, StreamRuntimeRunInput } from './types.js';
import type { RuntimeAdapterDependencies } from './ports.js';
export interface AgentRuntimeAdapter {
    readonly adapterId: string;
    readonly adapterVersion: string;
    probe(target: RuntimeTarget, options?: ProbeOptions): Promise<RuntimeProbeResult>;
    connect(config: RuntimeConnectionConfig, options?: ConnectOptions): Promise<RuntimeConnectionInfo>;
    health(options?: OperationOptions): Promise<RuntimeHealth>;
    capabilities(): Promise<RuntimeCapabilities>;
    ensureSession(input: EnsureSessionInput, options?: OperationOptions): Promise<RuntimeSession>;
    startRun(input: StartRuntimeRunInput, options?: OperationOptions): Promise<RuntimeRunHandle>;
    streamRun(input: StreamRuntimeRunInput, options?: OperationOptions): AsyncIterable<RuntimeEvent>;
    getRun(input: GetRuntimeRunInput, options?: OperationOptions): Promise<RuntimeRunSnapshot>;
    cancelRun(input: CancelRuntimeRunInput, options?: OperationOptions): Promise<void>;
    resolveApproval?(input: ResolveRuntimeApprovalInput, options?: OperationOptions): Promise<void>;
    getHistory(input: GetRuntimeHistoryInput, options?: OperationOptions): Promise<RuntimeMessage[]>;
    close(): Promise<void>;
}
export interface RuntimeAdapterFactory {
    readonly adapterId: string;
    create(dependencies: RuntimeAdapterDependencies): AgentRuntimeAdapter;
}
```

### async.d.ts

```ts
export declare function withDeadline<T>(work: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T>;
export declare function emptyAsyncIterable<T>(): AsyncIterable<T>;
export declare function collectBytes(body: AsyncIterable<Uint8Array>, maxBytes?: number): Promise<Uint8Array>;
export declare function readJsonBody(body: AsyncIterable<Uint8Array>, maxBytes?: number): Promise<unknown>;
export declare function runWithConcurrencyLimit<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]>;
```

### capabilities.d.ts

```ts
import type { RuntimeCapabilities, RuntimeCapabilityName, RuntimeUserInput } from './types.js';
export declare const NO_CAPABILITIES: RuntimeCapabilities;
export declare const TEXT_RUN_CAPABILITIES: RuntimeCapabilities;
export declare function supportsCapability(capabilities: RuntimeCapabilities, capability: RuntimeCapabilityName): boolean;
export declare function requireCapability(capabilities: RuntimeCapabilities, capability: RuntimeCapabilityName): void;
export declare function validateInputCapabilities(capabilities: RuntimeCapabilities, input: RuntimeUserInput): void;
export declare function assertStartRunInput(input: {
    idempotencyKey: string;
    applicationRunId: string;
}): void;
export declare function mergeCapabilities(base: RuntimeCapabilities, patch: Partial<RuntimeCapabilities>): RuntimeCapabilities;
```

### errors.d.ts

```ts
import type { RuntimeErrorCode } from './types.js';
export interface RuntimeErrorInput {
    message: string;
    code: RuntimeErrorCode;
    retryable: boolean;
    retryAfterMs?: number;
    adapterId?: string;
    details?: Readonly<Record<string, unknown>>;
    cause?: unknown;
}
export declare class RuntimeError extends Error {
    readonly code: RuntimeErrorCode;
    readonly retryable: boolean;
    readonly retryAfterMs?: number;
    readonly adapterId?: string;
    readonly details?: Readonly<Record<string, unknown>>;
    readonly cause?: unknown;
    constructor(input: RuntimeErrorInput);
}
export declare function sanitizeDetails(details: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>>;
export declare function sanitizeProviderPayload(value: unknown): unknown;
export declare function isRuntimeError(error: unknown): error is RuntimeError;
export declare function toRuntimeError(error: unknown, fallback: Omit<RuntimeErrorInput, 'cause'>): RuntimeError;
export declare function unsupportedCapability(message: string, details?: Record<string, unknown>): RuntimeError;
export declare function invalidConfiguration(message: string, details?: Record<string, unknown>): RuntimeError;
```

### events.d.ts

```ts
import type { RuntimeError } from './errors.js';
import type { RuntimeEvent, RuntimeEventBase, RuntimeEventName } from './types.js';
export declare function runtimeEventBase(input: {
    ids: {
        id(): string;
    };
    now: Date;
    type: RuntimeEventName;
    applicationRunId: string;
    externalRunId: string;
    externalSessionId: string;
    sequence?: number;
    provider?: RuntimeEventBase['provider'];
}): RuntimeEventBase;
export declare function isTerminalEvent(event: RuntimeEvent): boolean;
export declare function failedEventFromError(base: RuntimeEventBase, error: RuntimeError): RuntimeEvent;
export declare class SequenceTracker {
    private last?;
    accept(next?: number): {
        gap: boolean;
        expected?: number;
        actual?: number;
    };
}
```

### fingerprint.d.ts

```ts
import type { RuntimeCrypto } from './ports.js';
export declare function canonicalJson(value: unknown): string;
export declare function connectionFingerprint(crypto: RuntimeCrypto, input: Readonly<Record<string, unknown>>): Promise<string>;
export declare function normalizeEndpoint(endpoint: string): string;
```

### index.d.ts

```ts
export * from './adapter.js';
export * from './async.js';
export * from './capabilities.js';
export * from './errors.js';
export * from './events.js';
export * from './fingerprint.js';
export * from './ports.js';
export * from './registry.js';
export * from './security-limits.js';
export * from './test-ports.js';
export * from './types.js';
```

### ports.d.ts

```ts
import type { RuntimeHttpRequest, RuntimeHttpResponse, RuntimeSecret, RuntimeWebSocketEvent } from './types.js';
export interface RuntimeSecretStore {
    get(ref: string): Promise<RuntimeSecret | null>;
    set?(ref: string, value: RuntimeSecret): Promise<void>;
}
export interface RuntimeStateStore {
    get<T>(namespace: string, key: string): Promise<T | null>;
    set<T>(namespace: string, key: string, value: T): Promise<void>;
    delete(namespace: string, key: string): Promise<void>;
}
export interface RuntimeLogger {
    debug(message: string, fields?: Record<string, unknown>): void;
    info(message: string, fields?: Record<string, unknown>): void;
    warn(message: string, fields?: Record<string, unknown>): void;
    error(message: string, fields?: Record<string, unknown>): void;
}
export interface RuntimeClock {
    now(): Date;
    sleep(ms: number, signal?: AbortSignal): Promise<void>;
}
export interface RuntimeIdGenerator {
    id(): string;
}
export interface RuntimeHttpTransport {
    request(input: RuntimeHttpRequest): Promise<RuntimeHttpResponse>;
}
export interface RuntimeWebSocketConnection {
    send(data: string | Uint8Array): Promise<void>;
    events(): AsyncIterable<RuntimeWebSocketEvent>;
    close(code?: number, reason?: string): Promise<void>;
}
export interface RuntimeWebSocketFactory {
    connect(input: {
        url: string;
        headers?: Readonly<Record<string, string>>;
        signal?: AbortSignal;
        maxPayloadBytes?: number;
    }): Promise<RuntimeWebSocketConnection>;
}
export interface RuntimeCrypto {
    randomBytes(size: number): Uint8Array;
    sha256(input: string | Uint8Array): Promise<Uint8Array>;
    /**
     * Ed25519 keys are encoded as SPKI DER for public keys and PKCS8 DER for
     * private keys. Adapters that need raw public keys should derive them from
     * the SPKI envelope.
     */
    generateEd25519KeyPair(): Promise<{
        publicKey: Uint8Array;
        privateKey: Uint8Array;
    }>;
    signEd25519(privateKey: Uint8Array, message: Uint8Array): Promise<Uint8Array>;
}
export interface RuntimeLockManager {
    withLock<T>(key: string, options: {
        ttlMs: number;
        signal?: AbortSignal;
    }, work: () => Promise<T>): Promise<T>;
}
export type RuntimeAdapterDependencies = {
    secrets: RuntimeSecretStore;
    state: RuntimeStateStore;
    logger: RuntimeLogger;
    clock: RuntimeClock;
    ids: RuntimeIdGenerator;
    http: RuntimeHttpTransport;
    webSockets: RuntimeWebSocketFactory;
    crypto: RuntimeCrypto;
    locks?: RuntimeLockManager;
};
```

### registry.d.ts

```ts
import type { AgentRuntimeAdapter, RuntimeAdapterFactory } from './adapter.js';
import type { RuntimeAdapterDependencies } from './ports.js';
export declare class RuntimeRegistry {
    readonly dependencies: RuntimeAdapterDependencies;
    private readonly factories;
    constructor(dependencies: RuntimeAdapterDependencies);
    register(factory: RuntimeAdapterFactory): void;
    get(adapterId: string): RuntimeAdapterFactory;
    list(): RuntimeAdapterFactory[];
    create(adapterId: string): AgentRuntimeAdapter;
}
```

### security-limit-values.d.ts

```ts
export declare const SECURE_RUNTIME_LIMITS: Readonly<{
    maxJsonBodyBytes: 1000000;
    maxHttpHeaderBytes: 32000;
    maxWebSocketFrameBytes: 1000000;
    maxSseLineBytes: 64000;
    maxSseEventBytes: 1000000;
    maxSsePendingBytes: 1000000;
    maxRawPayloadDepth: 8;
    maxRawPayloadKeys: 1000;
    maxDiagnosticArrayItems: 100;
    maxDiagnosticStringLength: 4000;
    maxRedirects: 0;
    maxEventSubscriberQueue: 256;
    maxDeduplicationEntries: 1024;
    maxReconnectAttempts: 2;
    maxReconciliationMs: 30000;
    maxErrorDetailBytes: 64000;
    maxFixtureCandidateBytes: 2000000;
    maxCompatibilityReportBytes: 2000000;
}>;
export type SecureRuntimeLimitName = keyof typeof SECURE_RUNTIME_LIMITS;
export declare const HARD_RUNTIME_LIMITS: Readonly<Record<SecureRuntimeLimitName, number>>;
```

### security-limits.d.ts

```ts
import { type SecureRuntimeLimitName } from './security-limit-values.js';
export { HARD_RUNTIME_LIMITS, SECURE_RUNTIME_LIMITS, type SecureRuntimeLimitName } from './security-limit-values.js';
export declare function resolveSecureLimit(name: SecureRuntimeLimitName, value?: number, options?: {
    allowZero?: boolean;
}): number;
```

### test-ports.d.ts

```ts
import type { RuntimeAdapterDependencies, RuntimeClock, RuntimeCrypto, RuntimeHttpTransport, RuntimeIdGenerator, RuntimeLogger, RuntimeSecretStore, RuntimeStateStore, RuntimeWebSocketFactory } from './ports.js';
import type { RuntimeSecret } from './types.js';
export declare class MemoryStateStore implements RuntimeStateStore {
    private readonly values;
    get<T>(namespace: string, key: string): Promise<T | null>;
    set<T>(namespace: string, key: string, value: T): Promise<void>;
    delete(namespace: string, key: string): Promise<void>;
}
export declare class MemorySecretStore implements RuntimeSecretStore {
    private readonly values;
    get(ref: string): Promise<RuntimeSecret | null>;
    set(ref: string, value: RuntimeSecret): Promise<void>;
}
export declare const noopLogger: RuntimeLogger;
export declare const systemClock: RuntimeClock;
export declare class IncrementingIdGenerator implements RuntimeIdGenerator {
    private value;
    id(): string;
}
export declare const unavailableHttpTransport: RuntimeHttpTransport;
export declare const unavailableWebSocketFactory: RuntimeWebSocketFactory;
export declare const deterministicCrypto: RuntimeCrypto;
export declare function createTestDependencies(overrides?: Partial<RuntimeAdapterDependencies>): RuntimeAdapterDependencies;
```

### types.d.ts

```ts
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
export type RuntimeCapabilityName = 'sessions.create' | 'sessions.resume' | 'sessions.history' | 'sessions.fork' | 'runs.start' | 'runs.status' | 'runs.streamText' | 'runs.streamTools' | 'runs.cancel' | 'runs.approvals' | 'input.text' | 'input.images' | 'input.files' | 'output.text' | 'output.reasoning' | 'output.tools' | 'output.usage';
export type RuntimeAuthInput = {
    kind: 'bearer';
    token: string;
} | {
    kind: 'token';
    token: string;
} | {
    kind: 'password';
    password: string;
    username?: string;
} | {
    kind: 'device-token';
    token: string;
    deviceId?: string;
} | {
    kind: 'none';
};
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
export type RuntimeAttachment = {
    kind: 'image';
    mimeType: string;
    name?: string;
    data: Uint8Array;
} | {
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
    sessionStatePatch?: RuntimeSessionStatePatch;
    providerState?: Readonly<Record<string, unknown>>;
};
export type RuntimeSessionStatePatch = {
    previousResponseId?: string;
    externalSessionId?: string;
    providerState?: Readonly<Record<string, unknown>>;
};
export type RuntimeRunStatus = 'queued' | 'running' | 'waiting_for_approval' | 'stopping' | 'completed' | 'failed' | 'cancelled' | 'unknown';
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
export type RuntimeApprovalDecision = {
    action: 'allow';
    scope: 'once' | 'session' | 'always';
} | {
    action: 'deny';
};
export type ResolveRuntimeApprovalInput = {
    applicationRunId: string;
    externalRunId: string;
    approvalId: string;
    decision: RuntimeApprovalDecision;
    comment?: string;
};
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
    sessionStatePatch?: RuntimeSessionStatePatch;
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
export type RuntimeEventName = 'run.queued' | 'run.started' | 'assistant.delta' | 'assistant.completed' | 'reasoning.delta' | 'tool.started' | 'tool.updated' | 'tool.completed' | 'approval.requested' | 'approval.resolved' | 'usage.updated' | 'run.completed' | 'run.failed' | 'run.cancelled' | 'transport.warning' | 'transport.gap';
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
export type RuntimeQueuedEvent = RuntimeEventBase & {
    type: 'run.queued';
};
export type RuntimeStartedEvent = RuntimeEventBase & {
    type: 'run.started';
};
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
    availableDecisions: readonly RuntimeApprovalDecision[];
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
export type RuntimeEvent = RuntimeQueuedEvent | RuntimeStartedEvent | AssistantDeltaEvent | AssistantCompletedEvent | ReasoningDeltaEvent | ToolStartedEvent | ToolUpdatedEvent | ToolCompletedEvent | ApprovalRequestedEvent | ApprovalResolvedEvent | UsageUpdatedEvent | RunCompletedEvent | RunFailedEvent | RunCancelledEvent | TransportWarningEvent | TransportGapEvent;
export type RuntimeErrorCode = 'DETECTION_FAILED' | 'DETECTION_AMBIGUOUS' | 'AUTHENTICATION_REQUIRED' | 'AUTHENTICATION_FAILED' | 'AUTHORIZATION_FAILED' | 'PERMISSION_DENIED' | 'PAIRING_REQUIRED' | 'PROTOCOL_MISMATCH' | 'UNSUPPORTED_CAPABILITY' | 'INVALID_CONFIGURATION' | 'INVALID_REQUEST' | 'INVALID_RESPONSE' | 'NOT_FOUND' | 'CONFLICT' | 'RUNTIME_UNAVAILABLE' | 'PROVIDER_UNAVAILABLE' | 'RATE_LIMITED' | 'TIMEOUT' | 'NETWORK' | 'CANCELLED' | 'PROVIDER_ERROR' | 'OUTCOME_UNKNOWN' | 'INTERNAL';
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
export type RuntimeWebSocketEvent = {
    type: 'open';
} | {
    type: 'message';
    data: string | Uint8Array;
} | {
    type: 'error';
    error: unknown;
} | {
    type: 'close';
    code?: number;
    reason?: string;
};
export type RuntimeSecret = {
    value: string | Uint8Array;
    contentType?: string;
    expiresAt?: string;
};
```

## @banzae/agent-runtime-detection

### detector.d.ts

```ts
import { type RuntimeAdapterDependencies, type RuntimeTarget } from '@banzae/agent-runtime-core';
import { RuntimeProbeRegistry } from './probe-registry.js';
import type { RuntimeCredentialProvider, RuntimeDetectionDiagnostic, RuntimeDetectionInput, RuntimeDetectionResult, RuntimeDetectionStore, RuntimeNetworkPolicy, RuntimeProbe, RuntimeProbeResult } from './types.js';
export type RuntimeDetectorOptions = {
    dependencies: RuntimeAdapterDependencies;
    probes?: readonly RuntimeProbe[];
    store?: RuntimeDetectionStore;
    credentials?: RuntimeCredentialProvider;
    networkPolicy?: RuntimeNetworkPolicy;
    diagnostics?: (event: RuntimeDetectionDiagnostic) => void;
};
export declare class RuntimeDetector {
    private readonly options;
    readonly registry: RuntimeProbeRegistry;
    private readonly store;
    private readonly networkPolicy;
    constructor(options: RuntimeDetectorOptions);
    detect(input: RuntimeDetectionInput): Promise<RuntimeDetectionResult>;
    private detectWithFingerprint;
    private resolveAuth;
    private validCached;
    private invalidateCache;
    private readManifest;
    private detected;
    private emit;
}
export declare function createRuntimeDetector(options: RuntimeDetectorOptions): RuntimeDetector;
export declare function detectRuntime(input: RuntimeDetectionInput, options: RuntimeDetectorOptions): Promise<RuntimeDetectionResult>;
export declare function explicitAdapterId(input: RuntimeDetectionInput | RuntimeTarget): string | 'auto' | undefined;
export declare function schemeHint(target: RuntimeTarget): 'openclaw' | 'hermes' | undefined;
export declare function normalizeTargetEndpoint(target: RuntimeTarget): RuntimeTarget;
export declare function selectDetectionCandidate(candidates: readonly RuntimeProbeResult[], minimumConfidence?: number, ambiguityDelta?: number): RuntimeDetectionResult;
```

### index.d.ts

```ts
export * from './detector.js';
export * from './probe-registry.js';
export * from './probes.js';
export * from './security.js';
export * from './store.js';
export * from './types.js';
```

### probe-registry.d.ts

```ts
import type { RuntimeProbe } from './types.js';
export declare class RuntimeProbeRegistry {
    private readonly probes;
    constructor(probes?: readonly RuntimeProbe[]);
    register(probe: RuntimeProbe): void;
    get(adapterId: string): RuntimeProbe | undefined;
    require(adapterId: string): RuntimeProbe;
    list(): RuntimeProbe[];
    adapterIds(): string[];
}
```

### probes.d.ts

```ts
import type { RuntimeProbe } from './types.js';
export declare function createOpenClawProbe(): RuntimeProbe;
export declare function createHermesProbe(): RuntimeProbe;
```

### security.d.ts

```ts
import { type RuntimeAdapterDependencies, type RuntimeAuthInput, type RuntimeTarget } from '@banzae/agent-runtime-core';
import type { RuntimeNetworkPolicy } from './types.js';
export declare const DETECTION_SCHEMA_VERSION = 1;
export declare class DefaultRuntimeNetworkPolicy implements RuntimeNetworkPolicy {
    validateTarget(url: URL): Promise<void>;
    validateRedirect(from: URL, to: URL): Promise<void>;
}
export declare function normalizeDetectionEndpoint(endpoint: string): string;
export declare function detectionFingerprint(deps: RuntimeAdapterDependencies, input: {
    target: RuntimeTarget;
    adapterId?: string | 'auto';
    credentialRef?: string;
}): Promise<string>;
export declare function sanitizeDetectionValue(value: unknown): unknown;
export declare function sanitizeString(value: string): string;
export declare function authHeaders(auth?: RuntimeAuthInput): Readonly<Record<string, string>> | undefined;
```

### store.d.ts

```ts
import type { PersistedRuntimeDetection, RuntimeDetectionStore } from './types.js';
export declare class MemoryRuntimeDetectionStore implements RuntimeDetectionStore {
    private readonly values;
    get(key: string): Promise<PersistedRuntimeDetection | undefined>;
    set(key: string, value: PersistedRuntimeDetection): Promise<void>;
    delete(key: string): Promise<void>;
}
```

### types.d.ts

```ts
import type { RuntimeAdapterDependencies, RuntimeAuthInput, RuntimeCapabilities, RuntimeError, RuntimeTarget } from '@banzae/agent-runtime-core';
export type RuntimeProbeEvidence = {
    kind: string;
    message: string;
    adapterId?: string;
    confidence?: number;
    protocolName?: string;
    protocolVersion?: string;
    runtimeProduct?: string;
    runtimeVersion?: string;
    safeDetails?: Readonly<Record<string, unknown>>;
};
export type RuntimeDetectionOptions = {
    overallTimeoutMs?: number;
    probeTimeoutMs?: number;
    minimumConfidence?: number;
    ambiguityDelta?: number;
    allowManifest?: boolean;
    forceRedetect?: boolean;
    signal?: AbortSignal;
};
export type PersistedRuntimeDetection = {
    schemaVersion?: number;
    adapterId: string;
    runtimeProduct: string;
    runtimeVersion?: string;
    protocolName: string;
    protocolVersion?: string;
    capabilities?: RuntimeCapabilities;
    fingerprint: string;
    detectedAt: string;
    expiresAt?: string;
};
export type RuntimeDetectionInput = {
    target: RuntimeTarget;
    adapterId?: string | 'auto';
    credentialRef?: string;
    auth?: RuntimeAuthInput;
    cachedDetection?: PersistedRuntimeDetection;
    options?: RuntimeDetectionOptions;
};
export type RuntimeProbeResult = {
    adapterId: string;
    matched: boolean;
    confidence: number;
    runtimeProduct?: string;
    runtimeVersion?: string;
    protocolName?: string;
    protocolVersion?: string;
    capabilities?: RuntimeCapabilities;
    evidence: readonly RuntimeProbeEvidence[];
    error?: RuntimeError;
    durationMs?: number;
};
export type RuntimeDetectionResult = {
    status: 'detected' | 'ambiguous' | 'failed';
    selected?: RuntimeProbeResult;
    candidates: readonly RuntimeProbeResult[];
    fingerprint: string;
    detectedAt: string;
};
export type RuntimeProbeContext = {
    dependencies: RuntimeAdapterDependencies;
    auth?: RuntimeAuthInput;
    credentialRef?: string;
    signal?: AbortSignal;
    probeTimeoutMs: number;
    networkPolicy: RuntimeNetworkPolicy;
    emitDiagnostic(event: RuntimeDetectionDiagnostic): void;
};
export interface RuntimeProbe {
    readonly adapterId: string;
    probe(input: RuntimeDetectionInput, context: RuntimeProbeContext): Promise<RuntimeProbeResult>;
    supportsDetectionCache?(detection: PersistedRuntimeDetection): boolean;
}
export interface RuntimeDetectionStore {
    get(key: string): Promise<PersistedRuntimeDetection | undefined>;
    set(key: string, value: PersistedRuntimeDetection): Promise<void>;
    delete(key: string): Promise<void>;
}
export interface RuntimeCredentialProvider {
    resolve(reference: string): Promise<RuntimeAuthInput>;
}
export interface RuntimeNetworkPolicy {
    validateTarget(url: URL): Promise<void>;
    validateRedirect(from: URL, to: URL): Promise<void>;
}
export type RuntimeDetectionDiagnostic = {
    event: 'detection.started' | 'detection.cache_hit' | 'detection.cache_invalid' | 'detection.manifest_started' | 'detection.manifest_completed' | 'detection.probe_started' | 'detection.probe_completed' | 'detection.probe_failed' | 'detection.ambiguous' | 'detection.selected' | 'detection.failed';
    adapterId?: string;
    durationMs?: number;
    confidence?: number;
    protocolVersion?: string;
    hostname?: string;
    status?: string;
};
```

## @banzae/agent-runtime-node

### crypto.d.ts

```ts
import type { RuntimeCrypto } from '@banzae/agent-runtime-core';
export declare const nodeCrypto: RuntimeCrypto;
```

### index.d.ts

```ts
export { RuntimeRegistry, createTestDependencies, noopLogger, systemClock, IncrementingIdGenerator, type RuntimeAdapterDependencies, type RuntimeSecretStore, type RuntimeStateStore, } from '@banzae/agent-runtime-core';
export { detectRuntime } from '@banzae/agent-runtime-detection';
export { createHermesAdapterFactory } from '@banzae/agent-runtime-hermes';
export { createOpenClawAdapterFactory, openClawV3Codec, openClawV4Codec } from '@banzae/agent-runtime-openclaw';
export * from './crypto.js';
export * from './stores.js';
export * from './transports.js';
import { RuntimeRegistry, type RuntimeLogger, type RuntimeSecretStore, type RuntimeStateStore } from '@banzae/agent-runtime-core';
import { type HermesAdapterOptions } from '@banzae/agent-runtime-hermes';
import { type OpenClawAdapterOptions } from '@banzae/agent-runtime-openclaw';
export type CreateNodeRuntimeRegistryOptions = {
    stateStore: RuntimeStateStore;
    secretStore: RuntimeSecretStore;
    logger?: RuntimeLogger;
    openclaw?: OpenClawAdapterOptions | false;
    hermes?: HermesAdapterOptions | false;
};
export declare function createDefaultRuntimeRegistry(options: CreateNodeRuntimeRegistryOptions): RuntimeRegistry;
```

### stores.d.ts

```ts
import type { RuntimeSecret, RuntimeSecretStore, RuntimeStateStore } from '@banzae/agent-runtime-core';
export declare class NodeFileStateStore implements RuntimeStateStore {
    private readonly rootDir;
    constructor(rootDir: string);
    get<T>(namespace: string, key: string): Promise<T | null>;
    set<T>(namespace: string, key: string, value: T): Promise<void>;
    delete(namespace: string, key: string): Promise<void>;
    private path;
}
export declare class NodeMemorySecretStore implements RuntimeSecretStore {
    private readonly values;
    get(ref: string): Promise<RuntimeSecret | null>;
    set(ref: string, value: RuntimeSecret): Promise<void>;
}
```

### transports.d.ts

```ts
import { type RuntimeWebSocketConnection, type RuntimeWebSocketFactory, type RuntimeHttpRequest, type RuntimeHttpResponse, type RuntimeHttpTransport } from '@banzae/agent-runtime-core';
export declare class FetchHttpTransport implements RuntimeHttpTransport {
    request(input: RuntimeHttpRequest): Promise<RuntimeHttpResponse>;
}
export declare class WsWebSocketFactory implements RuntimeWebSocketFactory {
    connect(input: {
        url: string;
        headers?: Readonly<Record<string, string>>;
        signal?: AbortSignal;
        maxPayloadBytes?: number;
    }): Promise<RuntimeWebSocketConnection>;
}
```

## @banzae/agent-runtime-testing

### contract.d.ts

```ts
import { RuntimeError, type AgentRuntimeAdapter, type CancelRuntimeRunInput, type EnsureSessionInput, type GetRuntimeHistoryInput, type GetRuntimeRunInput, type RuntimeCapabilities, type RuntimeConnectionConfig, type RuntimeEvent, type RuntimeRunHandle, type RuntimeSession, type RuntimeTarget, type RuntimeUserInput, type StartRuntimeRunInput, type StreamRuntimeRunInput } from '@banzae/agent-runtime-core';
export type RuntimeConformanceCategory = 'connection' | 'capabilities' | 'sessions' | 'runs' | 'streaming' | 'status' | 'cancellation' | 'history' | 'security' | 'resources';
export type RuntimeConformanceCase = {
    name: string;
    category: RuntimeConformanceCategory;
    run(): Promise<void>;
};
export type RuntimeConformanceResourceSnapshot = {
    openConnections?: number;
    pendingRequests?: number;
    activeRuns?: number;
    activeSubscriptions?: number;
    activeResponseBodies?: number;
    listeners?: number;
    timers?: number;
};
export type RuntimeConformanceTarget = {
    connection: RuntimeConnectionConfig;
    resourceSnapshot?(): RuntimeConformanceResourceSnapshot;
    providerActivityCount?(): number;
    receivedIdempotencyKeys?(): readonly string[];
    triggerStream?(run: RuntimeRunHandle, session: RuntimeSession): void | Promise<void>;
    triggerApproval?(run: RuntimeRunHandle, session: RuntimeSession): void | Promise<void>;
    confirmCancellation?(input: CancelRuntimeRunInput): void | Promise<void>;
};
export type RuntimeAdapterConformanceScenarios<TTarget extends RuntimeConformanceTarget> = {
    session(target: TTarget): EnsureSessionInput;
    run(target: TTarget, session: RuntimeSession): StartRuntimeRunInput;
    stream?(target: TTarget, run: RuntimeRunHandle, session: RuntimeSession): StreamRuntimeRunInput;
    status?(target: TTarget, run: RuntimeRunHandle, session: RuntimeSession): GetRuntimeRunInput;
    cancel?(target: TTarget, run: RuntimeRunHandle, session: RuntimeSession): CancelRuntimeRunInput;
    history?(target: TTarget, session: RuntimeSession): GetRuntimeHistoryInput;
    connectionFailures?: readonly {
        name: string;
        expectedCode: RuntimeError['code'];
        prepare(target: TTarget): void | Promise<void>;
    }[];
};
export type RuntimeAdapterConformanceConfig<TTarget extends RuntimeConformanceTarget> = {
    name: string;
    createTarget(): TTarget | Promise<TTarget>;
    createAdapter(target: TTarget): AgentRuntimeAdapter | Promise<AgentRuntimeAdapter>;
    expectedCapabilities: RuntimeCapabilities | ((target: TTarget) => RuntimeCapabilities);
    scenarios: RuntimeAdapterConformanceScenarios<TTarget>;
    lifecycle?: {
        beforeCase?(target: TTarget, caseName: string): void | Promise<void>;
        cleanup?(adapter: AgentRuntimeAdapter, target: TTarget): void | Promise<void>;
    };
};
export type RuntimeAdapterConformanceSuite = {
    name: string;
    cases: readonly RuntimeConformanceCase[];
    run(): Promise<void>;
};
/**
 * Builds provider-neutral conformance cases without depending on a particular
 * test runner. Test runners should register each returned case independently.
 */
export declare function createRuntimeAdapterConformanceSuite<TTarget extends RuntimeConformanceTarget>(config: RuntimeAdapterConformanceConfig<TTarget>): RuntimeAdapterConformanceSuite;
export type AdapterTestHarness = {
    createAdapter(): Promise<AgentRuntimeAdapter>;
    target: RuntimeTarget;
    testInput: RuntimeUserInput;
    supports: Partial<RuntimeCapabilities>;
    cleanup(): Promise<void>;
};
/** @deprecated Use createRuntimeAdapterConformanceSuite. */
export declare function smokeAdapterContract(harness: AdapterTestHarness): Promise<void>;
export declare class RuntimeConformanceAssertionError extends Error {
    readonly name = "RuntimeConformanceAssertionError";
}
export declare function collectRuntimeEvents(stream: AsyncIterable<RuntimeEvent>, maximum?: number): Promise<RuntimeEvent[]>;
export declare function assertResourcesReleased(snapshot: RuntimeConformanceResourceSnapshot | undefined): void;
export declare function assertRuntimeError(work: () => Promise<unknown>, code: RuntimeError['code']): Promise<RuntimeError>;
```

### deterministic.d.ts

```ts
import { type RuntimeClock, type RuntimeIdGenerator } from '@banzae/agent-runtime-core';
export declare class DeterministicRuntimeClock implements RuntimeClock {
    private current;
    readonly sleeps: number[];
    constructor(current?: number);
    now(): Date;
    sleep(ms: number, signal?: AbortSignal): Promise<void>;
    advance(ms: number): void;
}
export declare class DeterministicRuntimeIdGenerator implements RuntimeIdGenerator {
    private readonly prefix;
    private sequence;
    constructor(prefix?: string);
    id(): string;
}
export declare function createSecretMarker(label: string): string;
export declare function assertSecretMarkersAbsent(value: unknown, markers: readonly string[]): void;
```

### fake-adapter.d.ts

```ts
import { type AgentRuntimeAdapter, type RuntimeCapabilities, type RuntimeEvent, type StartRuntimeRunInput } from '@banzae/agent-runtime-core';
export declare class FakeRuntimeAdapter implements AgentRuntimeAdapter {
    readonly adapterId = "fake";
    readonly adapterVersion = "0.1.0";
    private closed;
    private readonly caps;
    constructor(capabilities?: RuntimeCapabilities);
    probe(): Promise<{
        matched: boolean;
        confidence: number;
        adapterId: string;
        runtimeProduct: string;
        protocolName: string;
        protocolVersion: string;
        evidence: string[];
        warnings: never[];
        durationMs: number;
        capabilities: RuntimeCapabilities;
    }>;
    connect(): Promise<{
        descriptor: {
            schemaVersion: 1;
            adapterId: string;
            adapterVersion: string;
            runtimeProduct: string;
            protocolName: string;
            protocolVersion: string;
            capabilities: RuntimeCapabilities;
        };
        connectedAt: string;
        warnings: never[];
    }>;
    health(): Promise<{
        status: "healthy";
        checkedAt: string;
        warnings: never[];
    }>;
    capabilities(): Promise<RuntimeCapabilities>;
    ensureSession(input: {
        applicationSessionId: string;
    }): Promise<{
        applicationSessionId: string;
        externalSessionId: string;
        created: boolean;
    }>;
    startRun(input: StartRuntimeRunInput): Promise<{
        applicationRunId: string;
        externalRunId: string;
        status: "running";
    }>;
    streamRun(input: {
        applicationRunId: string;
        externalRunId: string;
        externalSessionId: string;
    }): AsyncIterable<RuntimeEvent>;
    getRun(input: {
        applicationRunId: string;
        externalRunId: string;
    }): Promise<{
        applicationRunId: string;
        externalRunId: string;
        status: "completed";
        output: string;
    }>;
    cancelRun(): Promise<void>;
    getHistory(): Promise<{
        role: "assistant";
        content: string;
    }[]>;
    close(): Promise<void>;
    isClosed(): boolean;
}
```

### fake-hermes-server.d.ts

```ts
import { type RuntimeHttpRequest, type RuntimeHttpResponse, type RuntimeHttpTransport } from '@banzae/agent-runtime-core';
export type FakeHermesRun = {
    id: string;
    status: string;
    output?: string;
    sessionId?: string;
    usage?: Record<string, number>;
    error?: unknown;
    events?: Array<{
        id?: string;
        event?: string;
        data: unknown;
    }>;
};
export declare class FakeHermesServer implements RuntimeHttpTransport {
    capabilities: Record<string, unknown>;
    health: Record<string, unknown>;
    detailedHealth: Record<string, unknown>;
    readonly requests: RuntimeHttpRequest[];
    readonly runs: Map<string, FakeHermesRun>;
    sessionsCreated: number;
    failAuth: boolean;
    nextRunCreateNetworkFailure: boolean;
    eventStreamFailures: number;
    streamRequests: number;
    statusRequests: number;
    readonly approvalBodies: Record<string, unknown>[];
    approvalStatus: number;
    approvalResponse?: unknown;
    failPermission: boolean;
    rateLimitRequests: number;
    retryAfterSeconds: number;
    malformedJsonPaths: Set<string>;
    malformedSse: boolean;
    fragmentedUtf8: boolean;
    wrongRunId: boolean;
    wrongSessionId: boolean;
    activeResponseBodies: number;
    closedResponseBodies: number;
    shutdownState: boolean;
    constructor();
    request(input: RuntimeHttpRequest): Promise<RuntimeHttpResponse>;
    shutdown(): Promise<void>;
    resourceSnapshot(): {
        openConnections: number;
        pendingRequests: number;
        activeRuns: number;
        activeSubscriptions: number;
        activeResponseBodies: number;
        listeners: number;
    };
    private responseJson;
    private responseSse;
    private responseBytes;
}
```

### fake-openclaw-server.d.ts

```ts
import { type RuntimeWebSocketConnection, type RuntimeWebSocketEvent, type RuntimeWebSocketFactory } from '@banzae/agent-runtime-core';
import type { RuntimeConformanceResourceSnapshot, RuntimeConformanceTarget } from './contract.js';
export type FakeOpenClawFailureMode = 'none' | 'authentication-required' | 'authentication-failed' | 'permission-denied' | 'pairing-required' | 'protocol-mismatch' | 'malformed-frame' | 'unavailable';
export type FakeOpenClawRun = {
    id: string;
    sessionKey: string;
    status: string;
    output?: string;
    sequence: number;
};
export type FakeOpenClawServerOptions = {
    authToken?: string;
    failureMode?: FakeOpenClawFailureMode;
    responseDelayMs?: number;
    reverseConcurrentResponses?: boolean;
    unresolvedRuns?: boolean;
    duplicateEvents?: boolean;
    sequenceGap?: boolean;
};
declare abstract class FakeOpenClawServerBase implements RuntimeWebSocketFactory {
    readonly options: FakeOpenClawServerOptions;
    abstract readonly protocolVersion: 3 | 4;
    abstract readonly runtimeVersion: string;
    abstract readonly eventNamespace: 'chat' | 'session';
    readonly runs: Map<string, FakeOpenClawRun>;
    readonly sessions: Set<string>;
    readonly receivedIdempotencyKeys: string[];
    readonly receivedProtocolVersions: number[];
    readonly receivedMethods: string[];
    openConnectionCount: number;
    listenerCount: number;
    pendingRequestCount: number;
    activeSubscriptionCount: number;
    shutdownState: boolean;
    providerActivity: number;
    private runSequence;
    private readonly connections;
    private readonly delayedResponses;
    private readonly timers;
    constructor(options?: FakeOpenClawServerOptions);
    connect(input: {
        url: string;
        signal?: AbortSignal;
    }): Promise<RuntimeWebSocketConnection>;
    shutdown(): Promise<void>;
    resourceSnapshot(): RuntimeConformanceResourceSnapshot;
    createTarget(endpoint?: string): RuntimeConformanceTarget;
    emitRunSuccess(runId: string, options?: {
        duplicate?: boolean;
        gap?: boolean;
    }): void;
    emitRunFailure(runId: string): void;
    emitUnrelatedEvent(): void;
    interruptSockets(): void;
    connectionClosed(connection: FakeOpenClawConnection): void;
    iteratorOpened(): void;
    iteratorClosed(): void;
    receive(connection: FakeOpenClawConnection, data: string | Uint8Array): Promise<void>;
    protected abstract challengeFrame(): Record<string, unknown>;
    protected abstract helloPayload(): Record<string, unknown>;
    protected abstract deltaEventName(): string;
    protected abstract completedEventName(): string;
    private handleRequest;
    protected runStartPayload(runId: string): Record<string, unknown>;
    protected historyPayload(): Record<string, unknown>;
    protected cancelPayload(runId: string): Record<string, unknown>;
    private connectFailure;
    private eventFrame;
    private broadcast;
    private requireRun;
}
/** Testing-only protocol v3 Gateway. Its v3 frame builders are independent. */
export declare class FakeOpenClawV3Server extends FakeOpenClawServerBase {
    readonly protocolVersion: 3;
    readonly runtimeVersion = "2026.4.22";
    readonly eventNamespace: "chat";
    protected challengeFrame(): Record<string, unknown>;
    protected helloPayload(): Record<string, unknown>;
    protected deltaEventName(): string;
    protected completedEventName(): string;
}
/** Testing-only protocol v4 Gateway with v4-specific session event fixtures. */
export declare class FakeOpenClawV4Server extends FakeOpenClawServerBase {
    readonly protocolVersion: 4;
    readonly runtimeVersion = "2026.6.11";
    readonly eventNamespace: "session";
    protected challengeFrame(): Record<string, unknown>;
    protected helloPayload(): Record<string, unknown>;
    protected deltaEventName(): string;
    protected completedEventName(): string;
    protected runStartPayload(runId: string): Record<string, unknown>;
    protected historyPayload(): Record<string, unknown>;
    protected cancelPayload(runId: string): Record<string, unknown>;
}
declare class FakeOpenClawConnection implements RuntimeWebSocketConnection {
    private readonly server;
    private readonly queue;
    private notify?;
    private closed;
    private iteratorActive;
    constructor(server: FakeOpenClawServerBase);
    send(data: string | Uint8Array): Promise<void>;
    events(): AsyncIterable<RuntimeWebSocketEvent>;
    close(code?: number, reason?: string): Promise<void>;
    push(event: RuntimeWebSocketEvent): void;
    pushMessage(value: string | Record<string, unknown>): void;
}
export {};
```

### index.d.ts

```ts
export * from './contract.js';
export * from './deterministic.js';
export * from './fake-adapter.js';
export * from './fake-hermes-server.js';
export * from './fake-openclaw-server.js';
export * from './live-compatibility.js';
```

### live-compatibility.d.ts

```ts
import { type AgentRuntimeAdapter, type RuntimeCapabilities } from '@banzae/agent-runtime-core';
export declare const LIVE_COMPATIBILITY_REPORT_SCHEMA_VERSION: 1;
export declare const LIVE_COMPATIBILITY_PROMPT = "Reply with exactly: BANZAE_RUNTIME_COMPATIBILITY_OK";
export declare const LIVE_COMPATIBILITY_PREFIX = "banzae-sdk-compat-";
export declare const LIVE_FIXTURE_SANITIZER_VERSION = "live-compatibility-v1";
export type LiveProvider = 'openclaw' | 'hermes';
export type LiveEnvironmentConfig = {
    provider: LiveProvider;
    endpoint: string;
    credentialRef?: string;
    expectedProtocol?: string;
    mutationPolicy: LiveMutationPolicy;
    captureFixtures: boolean;
};
export declare function parseLiveEnvironment(provider: LiveProvider, environment: Readonly<Record<string, string | undefined>>): LiveEnvironmentConfig;
export declare function validateLiveEndpoint(endpoint: string, provider: LiveProvider): void;
export type LiveMutationPolicy = {
    allowSessionCreation: boolean;
    allowRunCreation: boolean;
    allowCancellation: boolean;
    allowApproval: boolean;
};
export type LiveCompatibilityTarget = {
    adapterId: string;
    endpoint: string;
    credentialRef?: string;
    expectedProtocol?: string;
    mutationPolicy: LiveMutationPolicy;
};
export type LiveCheckResult = {
    id: string;
    category: string;
    required: boolean;
    destructive: boolean;
    status: 'passed' | 'failed' | 'skipped';
    durationMs: number;
    message: string;
    errorCode?: string;
    safeDetails?: Readonly<Record<string, unknown>>;
};
export type LiveCompatibilityCheckContext = {
    adapter: AgentRuntimeAdapter;
    target: LiveCompatibilityTarget;
    signal: AbortSignal;
    state: Map<string, unknown>;
};
export type LiveCompatibilityCheck = {
    id: string;
    category: string;
    required: boolean;
    destructive: boolean;
    timeoutMs?: number;
    run(context: LiveCompatibilityCheckContext): Promise<Omit<LiveCheckResult, 'id' | 'category' | 'required' | 'destructive' | 'durationMs'> | void>;
};
export type LiveCompatibilityReport = {
    schemaVersion: 1;
    generatedAt: string;
    evidenceType: 'sanitized-live';
    sdk: {
        commitSha: string;
        packageVersion: string;
        nodeVersion: string;
        platform: string;
    };
    target: {
        adapterId: string;
        endpointFingerprint: string;
        safeHostname?: string;
        runtimeProduct?: string;
        runtimeVersion?: string;
        protocolName?: string;
        protocolVersion?: string;
        adapterVersion?: string;
    };
    capabilities: RuntimeCapabilities;
    checks: readonly LiveCheckResult[];
    summary: {
        passed: number;
        failed: number;
        skipped: number;
        requiredChecksPassed: boolean;
    };
    limitations: readonly string[];
};
export type LiveCompatibilityReportMetadata = {
    commitSha: string;
    packageVersion: string;
    nodeVersion: string;
    platform: string;
    endpointFingerprint: string;
    safeHostname?: string;
    limitations?: readonly string[];
};
export type RunLiveCompatibilityOptions = {
    adapter: AgentRuntimeAdapter;
    target: LiveCompatibilityTarget;
    checks: readonly LiveCompatibilityCheck[];
    metadata: LiveCompatibilityReportMetadata;
    overallTimeoutMs?: number;
    defaultCheckTimeoutMs?: number;
    signal?: AbortSignal;
    now?: () => Date;
};
export declare function runLiveCompatibility(options: RunLiveCompatibilityOptions): Promise<LiveCompatibilityReport>;
export declare function validateLiveCompatibilityReport(value: unknown): asserts value is LiveCompatibilityReport;
export declare function assertNoLiveReportSecrets(value: unknown, markers?: readonly string[]): void;
export type LiveFixtureCandidate = {
    metadata: {
        adapterId: string;
        runtimeProduct?: string;
        runtimeVersion?: string;
        protocolName?: string;
        protocolVersion?: string;
        sdkCommitSha: string;
        captureDate: string;
        sanitizerVersion: string;
        source: 'sanitized-live-candidate';
        manualReviewRequired: true;
    };
    payload: unknown;
};
export declare function createLiveFixtureCandidate(input: {
    report: LiveCompatibilityReport;
    payload: unknown;
}): LiveFixtureCandidate;
export declare function validateLiveFixtureCandidate(value: unknown): asserts value is LiveFixtureCandidate;
export type LiveCompatibilityDiff = {
    runtimeVersionChanged: boolean;
    protocolVersionChanged: boolean;
    capabilityAdditions: readonly string[];
    capabilityRemovals: readonly string[];
    newlyFailingChecks: readonly string[];
    requiredChecksNowSkipped: readonly string[];
    errorClassificationChanges: readonly {
        id: string;
        before?: string;
        after?: string;
    }[];
    breakingRegression: boolean;
};
export declare function compareLiveCompatibilityReports(previous: LiveCompatibilityReport, current: LiveCompatibilityReport): LiveCompatibilityDiff;
export declare function sanitizeLiveValue(value: unknown, options?: {
    replaceIdentifiers?: boolean;
}): unknown;
export declare function formatLiveCompatibilityReport(report: LiveCompatibilityReport): string;
```

