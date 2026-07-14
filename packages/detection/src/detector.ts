import {
  RuntimeError,
  withDeadline,
  type RuntimeAdapterDependencies,
  type RuntimeAuthInput,
  type RuntimeCapabilities,
  type RuntimeTarget,
} from '@banzae/agent-runtime-core';
import { RuntimeProbeRegistry } from './probe-registry.js';
import { createHermesProbe, createOpenClawProbe } from './probes.js';
import { DefaultRuntimeNetworkPolicy, detectionFingerprint, normalizeDetectionEndpoint, sanitizeDetectionValue } from './security.js';
import { MemoryRuntimeDetectionStore } from './store.js';
import type {
  PersistedRuntimeDetection,
  RuntimeCredentialProvider,
  RuntimeDetectionDiagnostic,
  RuntimeDetectionInput,
  RuntimeDetectionOptions,
  RuntimeDetectionResult,
  RuntimeDetectionStore,
  RuntimeNetworkPolicy,
  RuntimeProbe,
  RuntimeProbeContext,
  RuntimeProbeEvidence,
  RuntimeProbeResult,
} from './types.js';

export type RuntimeDetectorOptions = {
  dependencies: RuntimeAdapterDependencies;
  probes?: readonly RuntimeProbe[];
  store?: RuntimeDetectionStore;
  credentials?: RuntimeCredentialProvider;
  networkPolicy?: RuntimeNetworkPolicy;
  diagnostics?: (event: RuntimeDetectionDiagnostic) => void;
};

const DEFAULT_OPTIONS: Required<Pick<RuntimeDetectionOptions, 'overallTimeoutMs' | 'probeTimeoutMs' | 'minimumConfidence' | 'ambiguityDelta' | 'allowManifest' | 'allowedRedirects'>> = {
  overallTimeoutMs: 15_000,
  probeTimeoutMs: 5_000,
  minimumConfidence: 0.9,
  ambiguityDelta: 0.05,
  allowManifest: true,
  allowedRedirects: 0,
};

export class RuntimeDetector {
  readonly registry: RuntimeProbeRegistry;
  private readonly store: RuntimeDetectionStore;
  private readonly networkPolicy: RuntimeNetworkPolicy;

  constructor(private readonly options: RuntimeDetectorOptions) {
    this.registry = new RuntimeProbeRegistry(options.probes ?? [createHermesProbe(), createOpenClawProbe()]);
    this.store = options.store ?? new MemoryRuntimeDetectionStore();
    this.networkPolicy = options.networkPolicy ?? new DefaultRuntimeNetworkPolicy();
  }

  async detect(input: RuntimeDetectionInput): Promise<RuntimeDetectionResult> {
    const startedAt = this.options.dependencies.clock.now();
    const detectionOptions = { ...DEFAULT_OPTIONS, ...input.options };
    const fingerprint = await detectionFingerprint(this.options.dependencies, {
      target: input.target,
      adapterId: input.adapterId ?? input.target.adapterHint ?? 'auto',
      credentialRef: input.credentialRef,
    });
    this.emit({ event: 'detection.started', hostname: safeHostname(input.target.endpoint) });
    await this.networkPolicy.validateTarget(new URL(normalizeDetectionEndpoint(input.target.endpoint)));

    return withDeadline(
      this.detectWithFingerprint(input, detectionOptions, fingerprint, startedAt),
      detectionOptions.overallTimeoutMs,
      undefined,
    );
  }

  private async detectWithFingerprint(
    input: RuntimeDetectionInput,
    options: Required<Pick<RuntimeDetectionOptions, 'overallTimeoutMs' | 'probeTimeoutMs' | 'minimumConfidence' | 'ambiguityDelta' | 'allowManifest' | 'allowedRedirects'>>,
    fingerprint: string,
    startedAt: Date,
  ): Promise<RuntimeDetectionResult> {
    const explicit = explicitAdapterId(input);
    if (explicit && explicit !== 'auto') {
      const probe = this.registry.require(explicit);
      const selected = explicitResult(probe.adapterId, input.target);
      this.emit({ event: 'detection.selected', adapterId: selected.adapterId, confidence: selected.confidence, hostname: safeHostname(input.target.endpoint) });
      return this.detected(selected, [selected], fingerprint, startedAt);
    }

    const cached = await this.validCached(input, fingerprint);
    if (cached) {
      const selected = fromPersisted(cached);
      this.emit({ event: 'detection.cache_hit', adapterId: selected.adapterId, confidence: selected.confidence, hostname: safeHostname(input.target.endpoint) });
      return this.detected(selected, [selected], fingerprint, startedAt);
    }

    const candidates: RuntimeProbeResult[] = [];
    const hint = schemeHint(input.target);
    if (hint) candidates.push(hintResult(hint, input.target));

    if (options.allowManifest) {
      const manifest = await this.readManifest(input, options).catch((error) => manifestError(error));
      if (manifest) candidates.push(manifest);
    }

    const auth = await this.resolveAuth(input);
    const probeResults = await Promise.all(
      this.registry.list().map(async (probe) => {
        this.emit({ event: 'detection.probe_started', adapterId: probe.adapterId, hostname: safeHostname(input.target.endpoint) });
        const context: RuntimeProbeContext = {
          dependencies: this.options.dependencies,
          auth,
          credentialRef: input.credentialRef,
          signal: undefined,
          probeTimeoutMs: options.probeTimeoutMs,
          networkPolicy: this.networkPolicy,
          emitDiagnostic: (event) => this.emit(event),
        };
        try {
          const result = await withDeadline(probe.probe(input, context), options.probeTimeoutMs);
          this.emit({ event: 'detection.probe_completed', adapterId: probe.adapterId, confidence: result.confidence, hostname: safeHostname(input.target.endpoint) });
          return result;
        } catch (error) {
          const result = probeFailure(probe.adapterId, error);
          this.emit({ event: 'detection.probe_failed', adapterId: probe.adapterId, hostname: safeHostname(input.target.endpoint), status: result.error?.code });
          return result;
        }
      }),
    );
    candidates.push(...probeResults);

    const selected = selectDetectionCandidate(candidates, options.minimumConfidence, options.ambiguityDelta);
    if (selected.status === 'detected' && selected.selected) {
      await this.store.set(fingerprint, toPersisted(selected.selected, fingerprint, this.options.dependencies.clock.now().toISOString()));
      this.emit({ event: 'detection.selected', adapterId: selected.selected.adapterId, confidence: selected.selected.confidence, hostname: safeHostname(input.target.endpoint) });
      return { ...selected, fingerprint, detectedAt: this.options.dependencies.clock.now().toISOString() };
    }
    this.emit({ event: selected.status === 'ambiguous' ? 'detection.ambiguous' : 'detection.failed', hostname: safeHostname(input.target.endpoint) });
    return { ...selected, fingerprint, detectedAt: this.options.dependencies.clock.now().toISOString() };
  }

  private async resolveAuth(input: RuntimeDetectionInput): Promise<RuntimeAuthInput | undefined> {
    if (input.auth) return input.auth;
    if (!input.credentialRef) return undefined;
    return this.options.credentials?.resolve(input.credentialRef);
  }

  private async validCached(input: RuntimeDetectionInput, fingerprint: string): Promise<PersistedRuntimeDetection | undefined> {
    if (input.options?.forceRedetect) return undefined;
    const cached = input.cachedDetection ?? (await this.store.get(fingerprint));
    if (!cached) return undefined;
    const now = this.options.dependencies.clock.now().getTime();
    if (cached.fingerprint !== fingerprint) {
      this.emit({ event: 'detection.cache_invalid', adapterId: cached.adapterId, status: 'fingerprint_mismatch' });
      return undefined;
    }
    if (cached.expiresAt && Date.parse(cached.expiresAt) <= now) {
      this.emit({ event: 'detection.cache_invalid', adapterId: cached.adapterId, status: 'expired' });
      return undefined;
    }
    if (!this.registry.get(cached.adapterId)) {
      this.emit({ event: 'detection.cache_invalid', adapterId: cached.adapterId, status: 'unsupported_adapter' });
      return undefined;
    }
    return cached;
  }

  private async readManifest(input: RuntimeDetectionInput, options: RuntimeDetectionOptions): Promise<RuntimeProbeResult | undefined> {
    const base = new URL(normalizeDetectionEndpoint(input.target.endpoint));
    if (base.protocol === 'ws:') base.protocol = 'http:';
    if (base.protocol === 'wss:') base.protocol = 'https:';
    if (base.protocol !== 'http:' && base.protocol !== 'https:') return undefined;
    const manifestUrl = new URL('/.well-known/agent-runtime.json', base);
    await this.networkPolicy.validateTarget(manifestUrl);
    this.emit({ event: 'detection.manifest_started', hostname: manifestUrl.hostname });
    const response = await withDeadline(
      this.options.dependencies.http.request({ url: manifestUrl.toString(), method: 'GET' }),
      options.probeTimeoutMs ?? DEFAULT_OPTIONS.probeTimeoutMs,
    );
    if (response.status === 404) return undefined;
    if (response.status < 200 || response.status >= 300) return undefined;
    const payload = JSON.parse(await readBody(response.body, 256_000)) as unknown;
    const manifest = parseManifest(payload);
    if (!manifest) return undefined;
    this.emit({ event: 'detection.manifest_completed', adapterId: manifest.adapterId, confidence: manifest.confidence, hostname: manifestUrl.hostname });
    return manifest;
  }

  private detected(selected: RuntimeProbeResult, candidates: RuntimeProbeResult[], fingerprint: string, startedAt: Date): RuntimeDetectionResult {
    return { status: 'detected', selected, candidates, fingerprint, detectedAt: startedAt.toISOString() };
  }

  private emit(event: RuntimeDetectionDiagnostic): void {
    this.options.diagnostics?.(sanitizeDetectionValue(event) as RuntimeDetectionDiagnostic);
  }
}

export function createRuntimeDetector(options: RuntimeDetectorOptions): RuntimeDetector {
  return new RuntimeDetector(options);
}

export async function detectRuntime(input: RuntimeDetectionInput, options: RuntimeDetectorOptions): Promise<RuntimeDetectionResult> {
  return new RuntimeDetector(options).detect(input);
}

export function explicitAdapterId(input: RuntimeDetectionInput | RuntimeTarget): string | 'auto' | undefined {
  if ('target' in input) return input.adapterId ?? input.target.adapterHint;
  if (input.adapterHint) return input.adapterHint;
  return undefined;
}

export function schemeHint(target: RuntimeTarget): 'openclaw' | 'hermes' | undefined {
  const scheme = target.endpoint.split(':', 1)[0];
  if (scheme === 'openclaw+ws' || scheme === 'openclaw+wss') return 'openclaw';
  if (scheme === 'hermes+http' || scheme === 'hermes+https') return 'hermes';
  return undefined;
}

export function normalizeTargetEndpoint(target: RuntimeTarget): RuntimeTarget {
  return { ...target, endpoint: normalizeDetectionEndpoint(target.endpoint) };
}

export function selectDetectionCandidate(
  candidates: readonly RuntimeProbeResult[],
  minimumConfidence = DEFAULT_OPTIONS.minimumConfidence,
  ambiguityDelta = DEFAULT_OPTIONS.ambiguityDelta,
): RuntimeDetectionResult {
  const matched = [...candidates].filter((candidate) => candidate.matched).sort((a, b) => b.confidence - a.confidence);
  const best = matched[0];
  if (!best || best.confidence < minimumConfidence) {
    return {
      status: 'failed',
      candidates,
      fingerprint: '',
      detectedAt: '',
    };
  }
  const second = matched[1];
  if (second && second.confidence >= minimumConfidence && best.confidence - second.confidence <= ambiguityDelta) {
    return { status: 'ambiguous', candidates, fingerprint: '', detectedAt: '' };
  }
  return { status: 'detected', selected: best, candidates, fingerprint: '', detectedAt: '' };
}

function explicitResult(adapterId: string, target: RuntimeTarget): RuntimeProbeResult {
  return {
    adapterId,
    matched: true,
    confidence: 1,
    runtimeProduct: adapterId,
    protocolName: `${adapterId}-explicit`,
    evidence: [{ kind: 'explicit.adapter', message: `explicit adapter ${adapterId}`, confidence: 1, safeDetails: { endpoint: safeHostname(target.endpoint) } }],
  };
}

function hintResult(adapterId: 'openclaw' | 'hermes', target: RuntimeTarget): RuntimeProbeResult {
  return {
    adapterId,
    matched: true,
    confidence: 0.8,
    runtimeProduct: adapterId,
    protocolName: `${adapterId}-scheme-hint`,
    evidence: [{ kind: 'scheme.hint', message: `${adapterId} connection-scheme hint`, confidence: 0.8, safeDetails: { endpoint: safeHostname(target.endpoint) } }],
  };
}

function fromPersisted(cached: PersistedRuntimeDetection): RuntimeProbeResult {
  return {
    adapterId: cached.adapterId,
    matched: true,
    confidence: 0.99,
    runtimeProduct: cached.runtimeProduct,
    runtimeVersion: cached.runtimeVersion,
    protocolName: cached.protocolName,
    protocolVersion: cached.protocolVersion,
    capabilities: cached.capabilities,
    evidence: [{ kind: 'cache.hit', message: 'valid persisted detection result', confidence: 0.99 }],
  };
}

function toPersisted(result: RuntimeProbeResult, fingerprint: string, detectedAt: string): PersistedRuntimeDetection {
  return {
    schemaVersion: 1,
    adapterId: result.adapterId,
    runtimeProduct: result.runtimeProduct ?? result.adapterId,
    runtimeVersion: result.runtimeVersion,
    protocolName: result.protocolName ?? result.adapterId,
    protocolVersion: result.protocolVersion,
    capabilities: result.capabilities,
    fingerprint,
    detectedAt,
  };
}

function parseManifest(payload: unknown): RuntimeProbeResult | undefined {
  const manifest = record(payload);
  if (manifest.schemaVersion !== 1) return undefined;
  const runtime = record(manifest.runtime);
  const product = runtime.product === 'openclaw' || runtime.product === 'hermes' ? runtime.product : undefined;
  if (!product) return undefined;
  const protocol = Array.isArray(manifest.protocols) ? record(manifest.protocols[0]) : {};
  return {
    adapterId: product,
    matched: true,
    confidence: 0.95,
    runtimeProduct: product,
    runtimeVersion: stringValue(runtime.version),
    protocolName: stringValue(protocol.name) ?? `${product}-manifest`,
    protocolVersion: stringValue(protocol.version),
    capabilities: manifestCapabilities(product),
    evidence: [{ kind: 'well-known.manifest', message: 'validated agent runtime manifest', confidence: 0.95, runtimeProduct: product }],
  };
}

function manifestCapabilities(product: string): RuntimeCapabilities | undefined {
  if (product !== 'hermes' && product !== 'openclaw') return undefined;
  return undefined;
}

function manifestError(error: unknown): RuntimeProbeResult | undefined {
  if (error instanceof RuntimeError && error.code === 'RUNTIME_UNAVAILABLE') return undefined;
  return undefined;
}

function probeFailure(adapterId: string, error: unknown): RuntimeProbeResult {
  const runtimeError =
    error instanceof RuntimeError
      ? error
      : new RuntimeError({ code: 'DETECTION_FAILED', retryable: false, message: 'Runtime probe failed', adapterId, details: { error: sanitizeDetectionValue(String(error)) } });
  return { adapterId, matched: false, confidence: 0, evidence: [], error: runtimeError };
}

async function readBody(body: AsyncIterable<Uint8Array>, maxBytes: number): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > maxBytes) {
      throw new RuntimeError({ code: 'PROVIDER_ERROR', retryable: false, message: 'Runtime manifest exceeded maximum size', adapterId: 'detection' });
    }
    chunks.push(chunk);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(output);
}

function safeHostname(endpoint: string): string | undefined {
  try {
    return new URL(normalizeDetectionEndpoint(endpoint)).hostname;
  } catch {
    return undefined;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}
