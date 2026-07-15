import type {
  RuntimeAdapterDependencies,
  RuntimeAuthInput,
  RuntimeCapabilities,
  RuntimeError,
  RuntimeTarget,
} from '@banzae/agent-runtime-core';

/** Public alpha contract for runtime probe evidence. */
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

/** Public alpha contract for runtime detection options. */
export type RuntimeDetectionOptions = {
  overallTimeoutMs?: number;
  probeTimeoutMs?: number;
  minimumConfidence?: number;
  ambiguityDelta?: number;
  allowManifest?: boolean;
  forceRedetect?: boolean;
  signal?: AbortSignal;
};

/** Public alpha contract for persisted runtime detection. */
export type PersistedRuntimeDetection = {
  schemaVersion: number;
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

/** Public alpha contract for runtime detection input. */
export type RuntimeDetectionInput = {
  target: RuntimeTarget;
  adapterId?: string | 'auto';
  credentialRef?: string;
  auth?: RuntimeAuthInput;
  cachedDetection?: PersistedRuntimeDetection;
  options?: RuntimeDetectionOptions;
};

/** Public alpha contract for runtime probe result. */
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

/** Public alpha contract for runtime detection result. */
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

/** Public alpha contract for runtime probe. */
export interface RuntimeProbe {
  readonly adapterId: string;
  probe(input: RuntimeDetectionInput, context: RuntimeProbeContext): Promise<RuntimeProbeResult>;
  supportsDetectionCache?(detection: PersistedRuntimeDetection): boolean;
}

/** Public alpha contract for runtime detection store. */
export interface RuntimeDetectionStore {
  get(key: string): Promise<PersistedRuntimeDetection | undefined>;
  set(key: string, value: PersistedRuntimeDetection): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Public alpha contract for runtime credential provider. */
export interface RuntimeCredentialProvider {
  resolve(reference: string): Promise<RuntimeAuthInput>;
}

/** Public alpha contract for runtime network policy. */
export interface RuntimeNetworkPolicy {
  validateTarget(url: URL): Promise<void>;
  validateRedirect(from: URL, to: URL): Promise<void>;
}

export type RuntimeDetectionDiagnostic = {
  event:
    | 'detection.started'
    | 'detection.cache_hit'
    | 'detection.cache_invalid'
    | 'detection.manifest_started'
    | 'detection.manifest_completed'
    | 'detection.probe_started'
    | 'detection.probe_completed'
    | 'detection.probe_failed'
    | 'detection.ambiguous'
    | 'detection.selected'
    | 'detection.failed';
  adapterId?: string;
  durationMs?: number;
  confidence?: number;
  protocolVersion?: string;
  hostname?: string;
  status?: string;
};
