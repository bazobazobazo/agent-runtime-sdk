import type {
  CancelRuntimeRunInput,
  ConnectOptions,
  EnsureSessionInput,
  GetRuntimeHistoryInput,
  GetRuntimeRunInput,
  OperationOptions,
  ProbeOptions,
  RuntimeCapabilities,
  RuntimeConnectionConfig,
  RuntimeConnectionInfo,
  RuntimeEvent,
  RuntimeHealth,
  RuntimeMessage,
  RuntimeProbeResult,
  RuntimeRunHandle,
  RuntimeRunSnapshot,
  RuntimeSession,
  RuntimeTarget,
  StartRuntimeRunInput,
  StreamRuntimeRunInput,
} from './types.js';
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
  getHistory(input: GetRuntimeHistoryInput, options?: OperationOptions): Promise<RuntimeMessage[]>;
  close(): Promise<void>;
}

export interface RuntimeAdapterFactory {
  readonly adapterId: string;
  create(dependencies: RuntimeAdapterDependencies): AgentRuntimeAdapter;
}
