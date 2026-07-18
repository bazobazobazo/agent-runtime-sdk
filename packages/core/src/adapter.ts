import type {
  CancelRuntimeRunInput,
  CreateRuntimeScheduleInput,
  ConnectOptions,
  EnsureSessionInput,
  GetRuntimeHistoryInput,
  GetRuntimeRunInput,
  GetRuntimeScheduleInput,
  ListRuntimeSchedulesInput,
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
  RuntimeSchedule,
  RuntimeScheduleExecution,
  RuntimeScheduleExecutionPage,
  RuntimeSchedulePage,
  RuntimeTarget,
  RuntimeAdapterLifecycleState,
  StartRuntimeRunInput,
  StreamRuntimeRunInput,
  UpdateRuntimeScheduleInput,
} from './types.js';
import type { RuntimeAdapterDependencies } from './ports.js';

/** Public alpha contract for agent runtime adapter. */
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
  createSchedule?(input: CreateRuntimeScheduleInput, options?: OperationOptions): Promise<RuntimeSchedule>;
  getSchedule?(input: GetRuntimeScheduleInput, options?: OperationOptions): Promise<RuntimeSchedule>;
  listSchedules?(input?: ListRuntimeSchedulesInput, options?: OperationOptions): Promise<RuntimeSchedulePage>;
  updateSchedule?(input: UpdateRuntimeScheduleInput, options?: OperationOptions): Promise<RuntimeSchedule>;
  deleteSchedule?(input: GetRuntimeScheduleInput, options?: OperationOptions): Promise<void>;
  enableSchedule?(input: GetRuntimeScheduleInput, options?: OperationOptions): Promise<void>;
  disableSchedule?(input: GetRuntimeScheduleInput, options?: OperationOptions): Promise<void>;
  pauseSchedule?(input: GetRuntimeScheduleInput, options?: OperationOptions): Promise<void>;
  resumeSchedule?(input: GetRuntimeScheduleInput, options?: OperationOptions): Promise<void>;
  triggerSchedule?(input: GetRuntimeScheduleInput, options?: OperationOptions): Promise<RuntimeScheduleExecution>;
  getScheduleHistory?(input: GetRuntimeScheduleInput & ListRuntimeSchedulesInput, options?: OperationOptions): Promise<RuntimeScheduleExecutionPage>;
  close(): Promise<void>;
}

/** Public alpha contract for runtime adapter factory. */
export interface RuntimeAdapterFactory {
  readonly adapterId: string;
  create(dependencies: RuntimeAdapterDependencies): AgentRuntimeAdapter;
}
