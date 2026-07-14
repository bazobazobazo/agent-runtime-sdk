import {
  RuntimeError,
  SECURE_RUNTIME_LIMITS,
  isRuntimeError,
  resolveSecureLimit,
  type AgentRuntimeAdapter,
  type RuntimeCapabilities,
  type RuntimeErrorCode,
} from '@banzae/agent-runtime-core';
import { sanitizeDetails, sanitizeProviderPayload } from '@banzae/agent-runtime-core/diagnostics';

export const LIVE_COMPATIBILITY_REPORT_SCHEMA_VERSION = 1 as const;
export const LIVE_COMPATIBILITY_PROMPT = 'Reply with exactly: BANZAE_RUNTIME_COMPATIBILITY_OK';
export const LIVE_COMPATIBILITY_PREFIX = 'banzae-sdk-compat-';
export const LIVE_FIXTURE_SANITIZER_VERSION = 'live-compatibility-v1';

export type LiveProvider = 'openclaw' | 'hermes';

export type LiveEnvironmentConfig = {
  provider: LiveProvider;
  endpoint: string;
  credentialRef?: string;
  expectedProtocol?: string;
  mutationPolicy: LiveMutationPolicy;
  captureFixtures: boolean;
};

export function parseLiveEnvironment(
  provider: LiveProvider,
  environment: Readonly<Record<string, string | undefined>>,
): LiveEnvironmentConfig {
  if (environment.RUNTIME_LIVE_ENABLED !== 'true') {
    throw new RuntimeError({ code: 'INVALID_CONFIGURATION', retryable: false, message: 'Live compatibility is disabled' });
  }
  const endpoint = provider === 'openclaw'
    ? environment.OPENCLAW_ENDPOINT ?? environment.OPENCLAW_GATEWAY_URL
    : environment.HERMES_ENDPOINT ?? environment.HERMES_BASE_URL;
  if (!endpoint) throw new RuntimeError({ code: 'INVALID_CONFIGURATION', retryable: false, message: 'Live runtime endpoint is required' });
  validateLiveEndpoint(endpoint, provider);
  const credentialRef = provider === 'openclaw'
    ? environment.OPENCLAW_CREDENTIAL_REF
    : environment.HERMES_CREDENTIAL_REF;
  if (credentialRef && !/^env:[A-Z_][A-Z0-9_]*$/.test(credentialRef)) {
    throw new RuntimeError({ code: 'INVALID_CONFIGURATION', retryable: false, message: 'Live credential reference is invalid' });
  }
  const selectedProtocol = provider === 'openclaw' ? environment.OPENCLAW_PROTOCOL ?? 'auto' : undefined;
  if (selectedProtocol && !['auto', '3', '4'].includes(selectedProtocol)) {
    throw new RuntimeError({ code: 'INVALID_CONFIGURATION', retryable: false, message: 'OpenClaw protocol selection is invalid' });
  }
  const mutation = environment.LIVE_ALLOW_MUTATION === 'true';
  const run = mutation && environment.LIVE_ALLOW_CHAT_RUN === 'true';
  return {
    provider,
    endpoint,
    credentialRef,
    expectedProtocol: selectedProtocol === 'auto' ? undefined : selectedProtocol,
    mutationPolicy: {
      allowSessionCreation: mutation,
      allowRunCreation: run,
      allowCancellation: run && environment.LIVE_ALLOW_CANCELLATION === 'true',
      allowApproval: mutation && environment.LIVE_ALLOW_APPROVAL === 'true',
    },
    captureFixtures: environment.LIVE_CAPTURE_FIXTURES === 'true',
  };
}

export function validateLiveEndpoint(endpoint: string, provider: LiveProvider): void {
  let url: URL;
  try {
    url = new URL(endpoint.replace(/^openclaw\+/, '').replace(/^hermes\+/, ''));
  } catch {
    throw new RuntimeError({ code: 'INVALID_CONFIGURATION', retryable: false, message: 'Live runtime endpoint is invalid' });
  }
  const allowed = provider === 'openclaw' ? ['ws:', 'wss:', 'http:', 'https:'] : ['http:', 'https:'];
  if (!allowed.includes(url.protocol) || url.username || url.password) {
    throw new RuntimeError({ code: 'INVALID_CONFIGURATION', retryable: false, message: 'Live runtime endpoint violates network policy' });
  }
  const blocked = new Set(['token', 'access_token', 'api_key', 'password', 'secret', 'authorization', 'device_token']);
  for (const key of url.searchParams.keys()) {
    if (blocked.has(key.toLowerCase())) {
      throw new RuntimeError({ code: 'INVALID_CONFIGURATION', retryable: false, message: 'Live runtime endpoint contains credential-like query data' });
    }
  }
}

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
  run(context: LiveCompatibilityCheckContext): Promise<
    | Omit<LiveCheckResult, 'id' | 'category' | 'required' | 'destructive' | 'durationMs'>
    | void
  >;
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

export async function runLiveCompatibility(
  options: RunLiveCompatibilityOptions,
): Promise<LiveCompatibilityReport> {
  const now = options.now ?? (() => new Date());
  const overallTimeoutMs = validateLiveTimeout(options.overallTimeoutMs ?? 60_000, 'overallTimeoutMs');
  const defaultCheckTimeoutMs = validateLiveTimeout(options.defaultCheckTimeoutMs ?? 10_000, 'defaultCheckTimeoutMs');
  const operationLink = linkedController(options.signal);
  const controller = operationLink.controller;
  const overallTimer = setTimeout(
    () => controller.abort(timeoutError('Live compatibility validation exceeded its overall timeout')),
    overallTimeoutMs,
  );
  const state = new Map<string, unknown>();
  const results: LiveCheckResult[] = [];
  let capabilities = disabledCapabilities();

  try {
    for (const check of options.checks) {
      if (controller.signal.aborted) throw controller.signal.reason;
      const started = now().getTime();
      const checkLink = linkedController(controller.signal);
      const checkController = checkLink.controller;
      const timer = setTimeout(
        () => checkController.abort(timeoutError(`Live check ${check.id} timed out`)),
        validateLiveTimeout(check.timeoutMs ?? defaultCheckTimeoutMs, `check ${check.id} timeoutMs`),
      );
      try {
        const outcome = await Promise.race([
          check.run({
            adapter: options.adapter,
            target: options.target,
            signal: checkController.signal,
            state,
          }),
          rejectOnAbort(checkController.signal),
        ]);
        results.push({
          id: check.id,
          category: check.category,
          required: check.required,
          destructive: check.destructive,
          status: outcome?.status ?? 'passed',
          durationMs: Math.max(0, now().getTime() - started),
          message: sanitizeText(outcome?.message ?? 'check passed'),
          errorCode: outcome?.errorCode,
          safeDetails: outcome?.safeDetails ? sanitizeSafeDetails(outcome.safeDetails) : undefined,
        });
      } catch (error) {
        const normalized = normalizeLiveError(error, check.id);
        results.push({
          id: check.id,
          category: check.category,
          required: check.required,
          destructive: check.destructive,
          status: 'failed',
          durationMs: Math.max(0, now().getTime() - started),
          message: sanitizeText(normalized.message),
          errorCode: normalized.code,
          safeDetails: normalized.details,
        });
      } finally {
        clearTimeout(timer);
        checkController.abort();
        checkLink.unlink();
      }
    }
    const capturedCapabilities = state.get('capabilities');
    capabilities = isCapabilities(capturedCapabilities)
      ? capturedCapabilities
      : await options.adapter.capabilities().catch(() => disabledCapabilities());
  } finally {
    clearTimeout(overallTimer);
    controller.abort();
    operationLink.unlink();
    await options.adapter.close().catch(() => undefined);
  }

  const connection = state.get('connection');
  const descriptor = isRecord(connection) && isRecord(connection.descriptor)
    ? connection.descriptor
    : undefined;
  const report: LiveCompatibilityReport = {
    schemaVersion: LIVE_COMPATIBILITY_REPORT_SCHEMA_VERSION,
    generatedAt: now().toISOString(),
    evidenceType: 'sanitized-live',
    sdk: {
      commitSha: safeScalar(options.metadata.commitSha),
      packageVersion: safeScalar(options.metadata.packageVersion),
      nodeVersion: safeScalar(options.metadata.nodeVersion),
      platform: safeScalar(options.metadata.platform),
    },
    target: {
      adapterId: safeScalar(options.target.adapterId),
      endpointFingerprint: safeScalar(options.metadata.endpointFingerprint),
      safeHostname: options.metadata.safeHostname ? safeHostname(options.metadata.safeHostname) : undefined,
      runtimeProduct: stringValue(descriptor?.runtimeProduct),
      runtimeVersion: stringValue(descriptor?.runtimeVersion),
      protocolName: stringValue(descriptor?.protocolName),
      protocolVersion: stringValue(descriptor?.protocolVersion),
      adapterVersion: stringValue(descriptor?.adapterVersion),
    },
    capabilities: sanitizeCapabilities(capabilities),
    checks: results.map(sanitizeCheckResult),
    summary: summarizeChecks(results),
    limitations: (options.metadata.limitations ?? []).map((value) => sanitizeText(value)),
  };
  validateLiveCompatibilityReport(report);
  assertNoLiveReportSecrets(report);
  return report;
}

export function validateLiveCompatibilityReport(value: unknown): asserts value is LiveCompatibilityReport {
  assertSerializedSize(value, SECURE_RUNTIME_LIMITS.maxCompatibilityReportBytes, 'Live compatibility report');
  if (!isRecord(value) || value.schemaVersion !== 1 || value.evidenceType !== 'sanitized-live') {
    throw invalidReport('Live compatibility report identity is invalid');
  }
  if (!isIsoDate(value.generatedAt) || !isRecord(value.sdk) || !isRecord(value.target)) {
    throw invalidReport('Live compatibility report metadata is invalid');
  }
  if (!nonEmpty(value.target.adapterId) || !nonEmpty(value.target.endpointFingerprint)) {
    throw invalidReport('Live compatibility report target is incomplete');
  }
  if (!isCapabilities(value.capabilities) || !Array.isArray(value.checks) || !isRecord(value.summary)) {
    throw invalidReport('Live compatibility report payload is invalid');
  }
  for (const check of value.checks) validateCheckResult(check);
  const summary = summarizeChecks(value.checks as LiveCheckResult[]);
  if (
    value.summary.passed !== summary.passed ||
    value.summary.failed !== summary.failed ||
    value.summary.skipped !== summary.skipped ||
    value.summary.requiredChecksPassed !== summary.requiredChecksPassed
  ) {
    throw invalidReport('Live compatibility report summary does not match checks');
  }
}

export function assertNoLiveReportSecrets(value: unknown, markers: readonly string[] = []): void {
  const serialized = JSON.stringify(value);
  const findings = [
    /"(?:authorization|cookie|session[_-]?key)"\s*:\s*"(?!\[redacted\]|__REDACTED__)[^"]{6,}"/i,
    /\bBearer\s+(?!\[redacted\])\S+/i,
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
    /[?&](?:token|access_token|api_key|password|secret|authorization|device_token)=/i,
    ...markers.filter(Boolean).map((marker) => new RegExp(escapeRegExp(marker), 'i')),
  ].filter((pattern) => pattern.test(serialized));
  if (findings.length > 0) throw invalidReport('Live compatibility report failed its final secret scan');
}

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

export function createLiveFixtureCandidate(input: {
  report: LiveCompatibilityReport;
  payload: unknown;
}): LiveFixtureCandidate {
  validateLiveCompatibilityReport(input.report);
  const candidate: LiveFixtureCandidate = {
    metadata: {
      adapterId: input.report.target.adapterId,
      runtimeProduct: input.report.target.runtimeProduct,
      runtimeVersion: input.report.target.runtimeVersion,
      protocolName: input.report.target.protocolName,
      protocolVersion: input.report.target.protocolVersion,
      sdkCommitSha: input.report.sdk.commitSha,
      captureDate: input.report.generatedAt,
      sanitizerVersion: LIVE_FIXTURE_SANITIZER_VERSION,
      source: 'sanitized-live-candidate',
      manualReviewRequired: true,
    },
    payload: sanitizeLiveValue(input.payload, { replaceIdentifiers: true }),
  };
  assertSerializedSize(candidate, SECURE_RUNTIME_LIMITS.maxFixtureCandidateBytes, 'Live fixture candidate');
  assertNoLiveReportSecrets(candidate);
  return candidate;
}

export function validateLiveFixtureCandidate(value: unknown): asserts value is LiveFixtureCandidate {
  assertSerializedSize(value, SECURE_RUNTIME_LIMITS.maxFixtureCandidateBytes, 'Live fixture candidate');
  if (!isRecord(value) || !isRecord(value.metadata)) throw invalidReport('Fixture candidate is malformed');
  if (value.metadata.source !== 'sanitized-live-candidate' || value.metadata.manualReviewRequired !== true) {
    throw invalidReport('Fixture candidate metadata is invalid');
  }
  if (value.metadata.sanitizerVersion !== LIVE_FIXTURE_SANITIZER_VERSION) {
    throw invalidReport('Fixture candidate sanitizer version is unsupported');
  }
  assertNoLiveReportSecrets(value);
}

export type LiveCompatibilityDiff = {
  runtimeVersionChanged: boolean;
  protocolVersionChanged: boolean;
  capabilityAdditions: readonly string[];
  capabilityRemovals: readonly string[];
  newlyFailingChecks: readonly string[];
  requiredChecksNowSkipped: readonly string[];
  errorClassificationChanges: readonly { id: string; before?: string; after?: string }[];
  breakingRegression: boolean;
};

export function compareLiveCompatibilityReports(
  previous: LiveCompatibilityReport,
  current: LiveCompatibilityReport,
): LiveCompatibilityDiff {
  validateLiveCompatibilityReport(previous);
  validateLiveCompatibilityReport(current);
  const beforeCapabilities = flattenCapabilities(previous.capabilities);
  const afterCapabilities = flattenCapabilities(current.capabilities);
  const beforeChecks = new Map(previous.checks.map((check) => [check.id, check]));
  const afterChecks = new Map(current.checks.map((check) => [check.id, check]));
  const newlyFailingChecks = [...afterChecks]
    .filter(([id, check]) => check.status === 'failed' && beforeChecks.get(id)?.status === 'passed')
    .map(([id]) => id)
    .sort();
  const requiredChecksNowSkipped = [...afterChecks]
    .filter(([id, check]) => check.required && check.status === 'skipped' && beforeChecks.get(id)?.status !== 'skipped')
    .map(([id]) => id)
    .sort();
  const errorClassificationChanges = [...afterChecks]
    .filter(([id, check]) => beforeChecks.has(id) && beforeChecks.get(id)?.errorCode !== check.errorCode)
    .map(([id, check]) => ({ id, before: beforeChecks.get(id)?.errorCode, after: check.errorCode }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const capabilityAdditions = [...afterCapabilities].filter((item) => !beforeCapabilities.has(item)).sort();
  const capabilityRemovals = [...beforeCapabilities].filter((item) => !afterCapabilities.has(item)).sort();
  return {
    runtimeVersionChanged: previous.target.runtimeVersion !== current.target.runtimeVersion,
    protocolVersionChanged: previous.target.protocolVersion !== current.target.protocolVersion,
    capabilityAdditions,
    capabilityRemovals,
    newlyFailingChecks,
    requiredChecksNowSkipped,
    errorClassificationChanges,
    breakingRegression: capabilityRemovals.length > 0 || newlyFailingChecks.length > 0 || requiredChecksNowSkipped.length > 0,
  };
}

export function sanitizeLiveValue(
  value: unknown,
  options: { replaceIdentifiers?: boolean } = {},
): unknown {
  return sanitizeUnknown(sanitizeProviderPayload(value), options, new WeakSet<object>());
}

export function formatLiveCompatibilityReport(report: LiveCompatibilityReport): string {
  validateLiveCompatibilityReport(report);
  const lines = [
    `${report.target.adapterId} live compatibility: ${report.summary.requiredChecksPassed ? 'PASS' : 'FAIL'}`,
    `protocol: ${report.target.protocolName ?? 'unknown'} ${report.target.protocolVersion ?? 'unknown'}`,
    `runtime: ${report.target.runtimeProduct ?? 'unknown'} ${report.target.runtimeVersion ?? 'unknown'}`,
    `checks: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.skipped} skipped`,
  ];
  for (const check of report.checks) lines.push(`- ${check.status.toUpperCase()} ${check.id}: ${check.message}`);
  return sanitizeText(lines.join('\n'));
}

function sanitizeUnknown(value: unknown, options: { replaceIdentifiers?: boolean }, seen: WeakSet<object>): unknown {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return sanitizeText(value, options.replaceIdentifiers);
  if (Array.isArray(value)) return value.slice(0, 1_000).map((item) => sanitizeUnknown(item, options, seen));
  if (typeof value !== 'object') return sanitizeText(String(value));
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>).slice(0, 1_000)) {
    output[key] = sensitiveKey(key)
      ? '[redacted]'
      : sanitizeUnknown(nested, options, seen);
  }
  return output;
}

function sanitizeText(value: string, replaceIdentifiers = false): string {
  let safe = value
    .replace(/\bAuthorization\s*:\s*Bearer\s+\S+/gi, 'Authorization: Bearer [redacted]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(token|access_token|api_key|password|cookie|secret|authorization|device_token|session_key|signature)=([^&\s]+)/gi, '$1=[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[redacted-jwt]')
    .replace(/(?:https?|wss?):\/\/[^\s"']+/gi, (match) => redactUrl(match))
    .replace(/\b(?:internal|private|corp)\.(?:[a-z0-9-]+\.)*[a-z]{2,63}\b/gi, '[redacted-host]')
    .replace(/\b(?:[a-z0-9-]+\.)+(?:internal|local|lan|corp)\b/gi, '[redacted-host]')
    .replace(/(?:\/home\/|\/Users\/)[^\s"']+/g, '[redacted-path]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[redacted-ip]');
  if (replaceIdentifiers) {
    safe = safe
      .replace(/\b(?:run|session|device|approval)[-_][A-Za-z0-9._:-]+/gi, (match) => `${match.split(/[-_]/)[0]}-placeholder`)
      .replace(LIVE_COMPATIBILITY_PROMPT, '[compatibility-prompt]');
  }
  return safe.slice(0, 4_000);
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}${url.pathname === '/' ? '' : '/[redacted-path]'}`;
  } catch {
    return '[redacted-url]';
  }
}

function sensitiveKey(key: string): boolean {
  if (/^(endpointFingerprint|safeHostname)$/i.test(key)) return false;
  return /(authorization|token|secret|password|cookie|credential|session.?key|device.?token|signature|private.?key|api.?key|prompt|tool.?arguments|raw|endpoint|url|path)/i.test(key);
}

function sanitizeCheckResult(value: LiveCheckResult): LiveCheckResult {
  return {
    ...value,
    message: sanitizeText(value.message),
    safeDetails: value.safeDetails ? sanitizeSafeDetails(value.safeDetails) : undefined,
  };
}

function sanitizeCapabilities(value: RuntimeCapabilities): RuntimeCapabilities {
  return JSON.parse(JSON.stringify(value)) as RuntimeCapabilities;
}

function sanitizeSafeDetails(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return sanitizeLiveValue(sanitizeDetails(value)) as Readonly<Record<string, unknown>>;
}

function summarizeChecks(checks: readonly LiveCheckResult[]) {
  return {
    passed: checks.filter((check) => check.status === 'passed').length,
    failed: checks.filter((check) => check.status === 'failed').length,
    skipped: checks.filter((check) => check.status === 'skipped').length,
    requiredChecksPassed: checks.every((check) => !check.required || check.status === 'passed'),
  };
}

function validateCheckResult(value: unknown): void {
  if (!isRecord(value) || !nonEmpty(value.id) || !nonEmpty(value.category)) throw invalidReport('Live check result is invalid');
  if (!['passed', 'failed', 'skipped'].includes(String(value.status)) || typeof value.durationMs !== 'number') {
    throw invalidReport('Live check result status is invalid');
  }
  if (typeof value.required !== 'boolean' || typeof value.destructive !== 'boolean' || !nonEmpty(value.message)) {
    throw invalidReport('Live check result metadata is invalid');
  }
}

function normalizeLiveError(error: unknown, stage: string): RuntimeError {
  if (isRuntimeError(error)) return new RuntimeError({
    code: error.code,
    retryable: error.retryable,
    retryAfterMs: error.retryAfterMs,
    adapterId: error.adapterId,
    message: safeErrorMessage(error.code),
    details: { stage, ...(error.details ?? {}) },
  });
  return new RuntimeError({
    code: 'PROVIDER_ERROR',
    retryable: false,
    message: 'Live compatibility check failed',
    details: { stage },
  });
}

function safeErrorMessage(code: RuntimeErrorCode): string {
  const messages: Partial<Record<RuntimeErrorCode, string>> = {
    AUTHENTICATION_REQUIRED: 'Authentication is required',
    AUTHENTICATION_FAILED: 'Authentication failed',
    PERMISSION_DENIED: 'Permission was denied',
    PAIRING_REQUIRED: 'Device pairing is required',
    PROTOCOL_MISMATCH: 'The selected protocol is incompatible',
    TIMEOUT: 'The live compatibility operation timed out',
    CANCELLED: 'The live compatibility operation was cancelled',
    INVALID_RESPONSE: 'The runtime returned an invalid response',
    PROVIDER_UNAVAILABLE: 'The runtime provider is unavailable',
  };
  return messages[code] ?? 'Live compatibility check failed';
}

function timeoutError(message: string): RuntimeError {
  return new RuntimeError({ code: 'TIMEOUT', retryable: true, message });
}

function invalidReport(message: string): RuntimeError {
  return new RuntimeError({ code: 'INVALID_RESPONSE', retryable: false, message });
}

function assertSerializedSize(value: unknown, maximum: number, label: string): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw invalidReport(`${label} could not be serialized safely`);
  }
  if (new TextEncoder().encode(serialized).byteLength > maximum) {
    throw invalidReport(`${label} exceeded its maximum size`);
  }
}

function validateLiveTimeout(value: number, label: string): number {
  try {
    return resolveSecureLimit('maxReconciliationMs', value);
  } catch {
    throw new RuntimeError({ code: 'INVALID_CONFIGURATION', retryable: false, message: `Live compatibility ${label} is invalid` });
  }
}

function linkedController(parent?: AbortSignal): { controller: AbortController; unlink: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason);
  if (parent?.aborted) controller.abort(parent.reason);
  else parent?.addEventListener('abort', abort, { once: true });
  return { controller, unlink: () => parent?.removeEventListener('abort', abort) };
}

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new RuntimeError({ code: 'CANCELLED', retryable: false, message: 'Live check was cancelled' }));
      return;
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

function safeScalar(value: string): string {
  return sanitizeText(value).slice(0, 256);
}

function safeHostname(value: string): string | undefined {
  if (!/^[a-z0-9.-]+$/i.test(value) || value === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(value)) return undefined;
  return sanitizeText(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? safeScalar(value) : undefined;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isIsoDate(value: unknown): boolean {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isCapabilities(value: unknown): value is RuntimeCapabilities {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  if (!isRecord(value.sessions) || !isRecord(value.runs) || !isRecord(value.input) || !isRecord(value.output) || !isRecord(value.health) || !isRecord(value.extensions)) return false;
  const { sessions, runs, input, output, health, extensions } = value;
  return [
    ...['create', 'resume', 'history', 'fork'].map((key) => sessions[key]),
    ...['start', 'status', 'stream', 'cancel', 'approvals'].map((key) => runs[key]),
    ...['text', 'images', 'files'].map((key) => input[key]),
    ...['text', 'reasoning', 'tools', 'usage'].map((key) => output[key]),
    ...['liveness', 'readiness'].map((key) => health[key]),
  ].every((item) => typeof item === 'boolean') && Object.values(extensions).every(
    (item) => typeof item === 'boolean' || typeof item === 'string' || typeof item === 'number',
  );
}

function disabledCapabilities(): RuntimeCapabilities {
  return {
    schemaVersion: 1,
    sessions: { create: false, resume: false, history: false, fork: false },
    runs: { start: false, status: false, stream: false, cancel: false, approvals: false },
    input: { text: false, images: false, files: false },
    output: { text: false, reasoning: false, tools: false, usage: false },
    health: { liveness: false, readiness: false },
    extensions: {},
  };
}

function flattenCapabilities(capabilities: RuntimeCapabilities): Set<string> {
  const output = new Set<string>();
  for (const [group, values] of Object.entries(capabilities)) {
    if (!isRecord(values)) continue;
    for (const [name, value] of Object.entries(values)) if (value === true) output.add(`${group}.${name}`);
  }
  return output;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
