import type {
  RuntimeAdapterDependencies,
  RuntimeAuthInput,
  RuntimeCapabilities,
  RuntimeError,
  RuntimeTarget,
} from '@banzae/agent-runtime-core';

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
  allowedRedirects?: number;
  forceRedetect?: boolean;
};

export type PersistedRuntimeDetection = {
  schemaVersion?: 1;
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
