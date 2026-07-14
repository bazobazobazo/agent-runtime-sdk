import type {
  CancelRuntimeRunInput,
  ConnectOptions,
  EnsureSessionInput,
  GetRuntimeHistoryInput,
  GetRuntimeRunInput,
  OperationOptions,
  ProbeOptions,
  ResolveRuntimeApprovalInput,
  RuntimeApprovalResolution,
  RuntimeCapabilities,
  RuntimeConnectionConfig,
  RuntimeConnectionInfo,
  RuntimeEvent,
  RuntimeHealth,
  RuntimeHistoryPage,
  RuntimeProbeResult,
  RuntimeRunHandle,
  RuntimeRunSnapshot,
  RuntimeSession,
  RuntimeTarget,
  RuntimeAdapterLifecycleState,
  StartRuntimeRunInput,
  StreamRuntimeRunInput,
} from './types.js';
import type { RuntimeAdapterDependencies } from './ports.js';

export interface AgentRuntimeAdapter {
  readonly adapterId: string;
  readonly adapterVersion: string;
  /** Current lifecycle state. `close()` is idempotent; reconnecting from `closed` is allowed. */
  readonly lifecycleState: RuntimeAdapterLifecycleState;

  probe(target: RuntimeTarget, options?: ProbeOptions): Promise<RuntimeProbeResult>;
  connect(config: RuntimeConnectionConfig, options?: ConnectOptions): Promise<RuntimeConnectionInfo>;
  health(options?: OperationOptions): Promise<RuntimeHealth>;
  capabilities(): Promise<RuntimeCapabilities>;
  ensureSession(input: EnsureSessionInput, options?: OperationOptions): Promise<RuntimeSession>;
  startRun(input: StartRuntimeRunInput, options?: OperationOptions): Promise<RuntimeRunHandle>;
  streamRun(input: StreamRuntimeRunInput, options?: OperationOptions): AsyncIterable<RuntimeEvent>;
  getRun(input: GetRuntimeRunInput, options?: OperationOptions): Promise<RuntimeRunSnapshot>;
  cancelRun(input: CancelRuntimeRunInput, options?: OperationOptions): Promise<void>;
  resolveApproval?(
    input: ResolveRuntimeApprovalInput,
    options?: OperationOptions,
  ): Promise<RuntimeApprovalResolution>;
  getHistory(input: GetRuntimeHistoryInput, options?: OperationOptions): Promise<RuntimeHistoryPage>;
  close(): Promise<void>;
}

export interface RuntimeAdapterFactory {
  readonly adapterId: string;
  create(dependencies: RuntimeAdapterDependencies): AgentRuntimeAdapter;
}
