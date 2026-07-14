import {
  RuntimeError,
  resolveSecureLimit,
  type RuntimeAdapterDependencies,
  type RuntimeAuthInput,
  type RuntimeCapabilities,
  type RuntimeTarget,
} from '@banzae/agent-runtime-core';
import { withDeadline } from '@banzae/agent-runtime-core/experimental';
import { RuntimeProbeRegistry } from './probe-registry.js';
import { createHermesProbe, createOpenClawProbe } from './probes.js';
import { DefaultRuntimeNetworkPolicy, DETECTION_SCHEMA_VERSION, detectionFingerprint, normalizeDetectionEndpoint, sanitizeDetectionValue } from './security.js';
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

const DEFAULT_OPTIONS: Required<Pick<RuntimeDetectionOptions, 'overallTimeoutMs' | 'probeTimeoutMs' | 'minimumConfidence' | 'ambiguityDelta' | 'allowManifest'>> = {
  overallTimeoutMs: 15_000,
  probeTimeoutMs: 5_000,
  minimumConfidence: 0.9,
  ambiguityDelta: 0.05,
  allowManifest: true,
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
    const detectionOptions = validateDetectionOptions({ ...DEFAULT_OPTIONS, ...input.options });
    const operation = createLinkedController(input.options?.signal);
    const overallTimeout = setTimeout(() => {
      operation.controller.abort(timeoutError(`Runtime detection timed out after ${detectionOptions.overallTimeoutMs}ms`, 'overall'));
    }, detectionOptions.overallTimeoutMs);
    try {
      const fingerprint = await detectionFingerprint(this.options.dependencies, {
        target: input.target,
        adapterId: input.adapterId ?? input.target.adapterHint ?? 'auto',
        credentialRef: input.credentialRef,
      });
      this.emit({ event: 'detection.started', hostname: safeHostname(input.target.endpoint) });
      throwIfAborted(operation.controller.signal);
      await this.networkPolicy.validateTarget(new URL(normalizeDetectionEndpoint(input.target.endpoint)));

      try {
        return await withDeadline(
          this.detectWithFingerprint(input, detectionOptions, fingerprint, startedAt, operation.controller.signal),
          detectionOptions.overallTimeoutMs,
          operation.controller.signal,
        );
      } catch (error) {
        if (operation.controller.signal.aborted) throw abortReason(operation.controller.signal);
        throw error;
      }
    } finally {
      clearTimeout(overallTimeout);
      operation.cleanup();
      operation.controller.abort(cancelledError('Runtime detection finished'));
    }
  }

  private async detectWithFingerprint(
    input: RuntimeDetectionInput,
    options: Required<Pick<RuntimeDetectionOptions, 'overallTimeoutMs' | 'probeTimeoutMs' | 'minimumConfidence' | 'ambiguityDelta' | 'allowManifest'>>,
    fingerprint: string,
    startedAt: Date,
    signal: AbortSignal,
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
      const manifest = await this.readManifest(input, options, signal).catch((error) => {
        if (signal.aborted) throw abortReason(signal);
        return manifestError(error);
      });
      if (manifest) candidates.push(manifest);
    }

    const auth = await this.resolveAuth(input);
    const probeResults = await Promise.all(
      this.registry.list().map(async (probe) => {
        this.emit({ event: 'detection.probe_started', adapterId: probe.adapterId, hostname: safeHostname(input.target.endpoint) });
        const probeController = createLinkedController(signal);
        const probeTimeout = setTimeout(() => {
          probeController.controller.abort(timeoutError(`Runtime probe timed out after ${options.probeTimeoutMs}ms`, probe.adapterId));
        }, options.probeTimeoutMs);
        const context: RuntimeProbeContext = {
          dependencies: this.options.dependencies,
          auth,
          credentialRef: input.credentialRef,
          signal: probeController.controller.signal,
          probeTimeoutMs: options.probeTimeoutMs,
          networkPolicy: this.networkPolicy,
          emitDiagnostic: (event) => this.emit(event),
        };
        try {
          const result = await withDeadline(probe.probe(input, context), options.probeTimeoutMs, probeController.controller.signal);
          this.emit({ event: 'detection.probe_completed', adapterId: probe.adapterId, confidence: result.confidence, hostname: safeHostname(input.target.endpoint) });
          return result;
        } catch (error) {
          if (signal.aborted) throw abortReason(signal);
          const result = probeFailure(probe.adapterId, probeController.controller.signal.aborted ? abortReason(probeController.controller.signal) : error);
          this.emit({ event: 'detection.probe_failed', adapterId: probe.adapterId, hostname: safeHostname(input.target.endpoint), status: result.error?.code });
          return result;
        } finally {
          clearTimeout(probeTimeout);
          probeController.cleanup();
          probeController.controller.abort(cancelledError('Runtime probe finished'));
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
    if (!this.options.credentials) {
      throw new RuntimeError({
        code: 'INVALID_CONFIGURATION',
        retryable: false,
        message: 'Credential reference requires a RuntimeCredentialProvider',
        adapterId: 'detection',
        details: { credentialRef: '[redacted]' },
      });
    }
    try {
      const auth = await this.options.credentials.resolve(input.credentialRef);
      if (!auth) {
        throw new RuntimeError({
          code: 'INVALID_CONFIGURATION',
          retryable: false,
          message: 'Credential reference could not be resolved',
          adapterId: 'detection',
        });
      }
      return auth;
    } catch (error) {
      if (error instanceof RuntimeError) return Promise.reject(error);
      throw new RuntimeError({
        code: 'INVALID_CONFIGURATION',
        retryable: false,
        message: 'Credential reference could not be resolved',
        adapterId: 'detection',
        details: safeProviderErrorDetails(error),
      });
    }
  }

  private async validCached(input: RuntimeDetectionInput, fingerprint: string): Promise<PersistedRuntimeDetection | undefined> {
    if (input.options?.forceRedetect) return undefined;
    const cached = input.cachedDetection ?? (await this.store.get(fingerprint));
    if (!cached) return undefined;
    const now = this.options.dependencies.clock.now().getTime();
    if (cached.schemaVersion !== DETECTION_SCHEMA_VERSION) {
      await this.invalidateCache(fingerprint, cached, 'unsupported_schema_version');
      return undefined;
    }
    if (cached.fingerprint !== fingerprint) {
      await this.invalidateCache(fingerprint, cached, 'fingerprint_mismatch');
      return undefined;
    }
    if (cached.expiresAt && Date.parse(cached.expiresAt) <= now) {
      await this.invalidateCache(fingerprint, cached, 'expired');
      return undefined;
    }
    const probe = this.registry.get(cached.adapterId);
    if (!probe) {
      await this.invalidateCache(fingerprint, cached, 'unsupported_adapter');
      return undefined;
    }
    if (!probe.supportsDetectionCache?.(cached)) {
      await this.invalidateCache(fingerprint, cached, 'unsupported_protocol');
      return undefined;
    }
    return cached;
  }

  private async invalidateCache(fingerprint: string, cached: PersistedRuntimeDetection, status: string): Promise<void> {
    this.emit({ event: 'detection.cache_invalid', adapterId: cached.adapterId, status });
    await this.store.delete(fingerprint).catch(() => undefined);
  }

  private async readManifest(input: RuntimeDetectionInput, options: RuntimeDetectionOptions, signal: AbortSignal): Promise<RuntimeProbeResult | undefined> {
    const base = new URL(normalizeDetectionEndpoint(input.target.endpoint));
    if (base.protocol === 'ws:') base.protocol = 'http:';
    if (base.protocol === 'wss:') base.protocol = 'https:';
    if (base.protocol !== 'http:' && base.protocol !== 'https:') return undefined;
    const manifestUrl = new URL('/.well-known/agent-runtime.json', base);
    await this.networkPolicy.validateTarget(manifestUrl);
    this.emit({ event: 'detection.manifest_started', hostname: manifestUrl.hostname });
    const response = await withDeadline(
      this.options.dependencies.http.request({ url: manifestUrl.toString(), method: 'GET', signal }),
      options.probeTimeoutMs ?? DEFAULT_OPTIONS.probeTimeoutMs,
      signal,
    );
    if (response.status === 404) {
      await closeBody(response.body);
      return undefined;
    }
    if (response.status < 200 || response.status >= 300) {
      await closeBody(response.body);
      return undefined;
    }
    const payload = JSON.parse(await readBody(response.body, 256_000, signal)) as unknown;
    const manifest = parseManifest(payload);
    if (!manifest) return undefined;
    this.emit({ event: 'detection.manifest_completed', adapterId: manifest.adapterId, confidence: manifest.confidence, hostname: manifestUrl.hostname });
    return manifest;
  }

  private detected(selected: RuntimeProbeResult, candidates: RuntimeProbeResult[], fingerprint: string, startedAt: Date): RuntimeDetectionResult {
    return { status: 'detected', selected, candidates, fingerprint, detectedAt: startedAt.toISOString() };
  }

  private emit(event: RuntimeDetectionDiagnostic): void {
    try {
      this.options.diagnostics?.(sanitizeDetectionValue(event) as RuntimeDetectionDiagnostic);
    } catch {
      // Diagnostics are observational. A host logger must never break detection.
    }
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
    schemaVersion: DETECTION_SCHEMA_VERSION,
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

function validateDetectionOptions(
  options: Required<Pick<RuntimeDetectionOptions, 'overallTimeoutMs' | 'probeTimeoutMs' | 'minimumConfidence' | 'ambiguityDelta' | 'allowManifest'>>,
): Required<Pick<RuntimeDetectionOptions, 'overallTimeoutMs' | 'probeTimeoutMs' | 'minimumConfidence' | 'ambiguityDelta' | 'allowManifest'>> {
  const overallTimeoutMs = resolveSecureLimit('maxReconciliationMs', options.overallTimeoutMs);
  const probeTimeoutMs = resolveSecureLimit('maxReconciliationMs', options.probeTimeoutMs);
  if (!Number.isFinite(options.minimumConfidence) || options.minimumConfidence < 0 || options.minimumConfidence > 1) {
    throw new RuntimeError({ code: 'INVALID_CONFIGURATION', retryable: false, message: 'Detection minimumConfidence must be between zero and one', adapterId: 'detection' });
  }
  if (!Number.isFinite(options.ambiguityDelta) || options.ambiguityDelta < 0 || options.ambiguityDelta > 1) {
    throw new RuntimeError({ code: 'INVALID_CONFIGURATION', retryable: false, message: 'Detection ambiguityDelta must be between zero and one', adapterId: 'detection' });
  }
  return { ...options, overallTimeoutMs, probeTimeoutMs };
}

function manifestCapabilities(product: string): RuntimeCapabilities | undefined {
  if (product !== 'hermes' && product !== 'openclaw') return undefined;
  return undefined;
}

function manifestError(error: unknown): RuntimeProbeResult | undefined {
  if (error instanceof RuntimeError && error.code === 'PROVIDER_UNAVAILABLE') return undefined;
  return undefined;
}

function probeFailure(adapterId: string, error: unknown): RuntimeProbeResult {
  const runtimeError =
    error instanceof RuntimeError
      ? error
      : new RuntimeError({ code: 'DETECTION_FAILED', retryable: false, message: 'Runtime probe failed', adapterId, details: safeProviderErrorDetails(error) });
  return { adapterId, matched: false, confidence: 0, evidence: [], error: runtimeError };
}

async function readBody(body: AsyncIterable<Uint8Array>, maxBytes: number, signal?: AbortSignal): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const iterator = body[Symbol.asyncIterator]();
  let done = false;
  const onAbort = () => {
    void iterator.return?.();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    while (true) {
      throwIfAborted(signal);
      const next = await iterator.next();
      if (next.done) {
        done = true;
        break;
      }
      const chunk = next.value;
      size += chunk.byteLength;
      if (size > maxBytes) {
        throw new RuntimeError({ code: 'PROVIDER_ERROR', retryable: false, message: 'Runtime manifest exceeded maximum size', adapterId: 'detection' });
      }
      chunks.push(chunk);
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (!done) await iterator.return?.().catch(() => undefined);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(output);
}

async function closeBody(body: AsyncIterable<Uint8Array>): Promise<void> {
  const iterator = body[Symbol.asyncIterator]();
  await iterator.return?.().catch(() => undefined);
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

function createLinkedController(parent?: AbortSignal): { controller: AbortController; cleanup: () => void } {
  const controller = new AbortController();
  if (!parent) return { controller, cleanup: () => undefined };
  if (parent.aborted) {
    controller.abort(abortReason(parent));
    return { controller, cleanup: () => undefined };
  }
  const onAbort = () => controller.abort(abortReason(parent));
  parent.addEventListener('abort', onAbort, { once: true });
  return { controller, cleanup: () => parent.removeEventListener('abort', onAbort) };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal): RuntimeError {
  return signal.reason instanceof RuntimeError ? signal.reason : cancelledError('Runtime detection was cancelled');
}

function timeoutError(message: string, stage: string): RuntimeError {
  return new RuntimeError({ code: 'TIMEOUT', retryable: true, message, adapterId: 'detection', details: { stage } });
}

function cancelledError(message: string): RuntimeError {
  return new RuntimeError({ code: 'CANCELLED', retryable: false, message, adapterId: 'detection' });
}

function safeProviderErrorDetails(error: unknown): Record<string, unknown> {
  const details: Record<string, unknown> = {};
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    if (typeof record.code === 'string') details.providerCode = sanitizeDetectionValue(record.code);
    if (typeof record.status === 'number') details.status = record.status;
    if (record.name && typeof record.name === 'string') details.providerErrorName = sanitizeDetectionValue(record.name);
  }
  return details;
}
