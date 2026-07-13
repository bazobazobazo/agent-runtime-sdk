import {
  RuntimeError,
  RuntimeRegistry,
  runWithConcurrencyLimit,
  withDeadline,
  type RuntimeAdapterDependencies,
  type RuntimeProbeResult,
  type RuntimeTarget,
} from '@banzae/agent-runtime-core';

export type DetectionThresholds = {
  minConfidence: number;
  minMargin: number;
};

export type CachedDetectionResult = RuntimeProbeResult & {
  connectionFingerprint: string;
  detectedAt: string;
};

export type DetectionOptions = {
  registry: RuntimeRegistry;
  dependencies?: RuntimeAdapterDependencies;
  allowedAdapterIds?: string[];
  probeTimeoutMs?: number;
  maxConcurrentProbes?: number;
  signal?: AbortSignal;
  thresholds?: DetectionThresholds;
  cached?: CachedDetectionResult;
  connectionFingerprint?: string;
};

const DEFAULT_THRESHOLDS: DetectionThresholds = {
  minConfidence: 0.9,
  minMargin: 0.15,
};

export async function detectRuntime(
  target: RuntimeTarget,
  options: DetectionOptions,
): Promise<RuntimeProbeResult> {
  const explicit = explicitAdapterId(target);
  const cached = validCachedResult(options.cached, options.connectionFingerprint);
  if (cached) return cached;

  const factories = options.registry
    .list()
    .filter((factory) => {
      if (explicit) return factory.adapterId === explicit;
      return options.allowedAdapterIds?.includes(factory.adapterId) ?? true;
    });

  if (factories.length === 0) {
    throw new RuntimeError({
      code: 'DETECTION_FAILED',
      retryable: false,
      message: explicit
        ? `No runtime adapter is registered for ${explicit}`
        : 'No runtime adapters are registered for detection',
      details: { adapterId: explicit },
    });
  }

  const results = await runWithConcurrencyLimit(
    factories,
    options.maxConcurrentProbes ?? 2,
    async (factory) => {
      const adapter = factory.create(options.registry.dependencies);
      try {
        return await withDeadline(
          adapter.probe(target, {
            signal: options.signal,
            allowAuthentication: true,
          }),
          options.probeTimeoutMs ?? 5_000,
          options.signal,
        );
      } catch (error) {
        return {
          matched: false,
          confidence: 0,
          adapterId: factory.adapterId,
          evidence: [],
          warnings: [error instanceof Error ? error.message : String(error)],
          durationMs: options.probeTimeoutMs ?? 5_000,
        } satisfies RuntimeProbeResult;
      } finally {
        await adapter.close().catch(() => undefined);
      }
    },
  );

  return selectUnambiguousResult(results, options.thresholds ?? DEFAULT_THRESHOLDS, explicit);
}

export function explicitAdapterId(target: RuntimeTarget): string | undefined {
  if (target.adapterHint) return target.adapterHint;
  const scheme = target.endpoint.split(':', 1)[0];
  if (scheme === 'openclaw+ws' || scheme === 'openclaw+wss' || scheme === 'openclaw') return 'openclaw';
  if (scheme === 'hermes+http' || scheme === 'hermes+https' || scheme === 'hermes') return 'hermes';
  return undefined;
}

export function normalizeTargetEndpoint(target: RuntimeTarget): RuntimeTarget {
  return {
    ...target,
    endpoint: target.endpoint
      .replace(/^openclaw\+ws:/, 'ws:')
      .replace(/^openclaw\+wss:/, 'wss:')
      .replace(/^hermes\+http:/, 'http:')
      .replace(/^hermes\+https:/, 'https:')
      .replace(/^agent\+http:/, 'http:')
      .replace(/^agent\+https:/, 'https:'),
  };
}

export function validCachedResult(
  cached: CachedDetectionResult | undefined,
  connectionFingerprint: string | undefined,
): CachedDetectionResult | undefined {
  if (!cached || !connectionFingerprint) return undefined;
  if (cached.connectionFingerprint !== connectionFingerprint) return undefined;
  if (!cached.matched || cached.confidence < DEFAULT_THRESHOLDS.minConfidence) return undefined;
  return cached;
}

export function selectUnambiguousResult(
  results: readonly RuntimeProbeResult[],
  thresholds: DetectionThresholds = DEFAULT_THRESHOLDS,
  explicitAdapterId?: string,
): RuntimeProbeResult {
  const sorted = [...results].sort((a, b) => b.confidence - a.confidence);
  const best = sorted[0];
  if (!best || !best.matched) {
    throw new RuntimeError({
      code: 'DETECTION_FAILED',
      retryable: false,
      message: 'No supported agent runtime was detected',
      details: { results: summarizedResults(results) },
    });
  }

  if (explicitAdapterId) {
    if (best.adapterId !== explicitAdapterId) {
      throw new RuntimeError({
        code: 'DETECTION_FAILED',
        retryable: false,
        message: `Explicit adapter ${explicitAdapterId} did not match target`,
      });
    }
    return best;
  }

  const second = sorted[1];
  const margin = best.confidence - (second?.confidence ?? 0);
  if (best.confidence < thresholds.minConfidence || margin < thresholds.minMargin) {
    throw new RuntimeError({
      code: 'DETECTION_AMBIGUOUS',
      retryable: false,
      message: 'Runtime detection was ambiguous',
      details: { results: summarizedResults(results), bestConfidence: best.confidence, margin },
    });
  }

  return best;
}

function summarizedResults(results: readonly RuntimeProbeResult[]): Array<Record<string, unknown>> {
  return results.map((result) => ({
    adapterId: result.adapterId,
    matched: result.matched,
    confidence: result.confidence,
    runtimeProduct: result.runtimeProduct,
    protocolName: result.protocolName,
    protocolVersion: result.protocolVersion,
    evidence: result.evidence,
    warnings: result.warnings,
  }));
}
