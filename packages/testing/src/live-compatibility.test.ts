import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { FakeRuntimeAdapter } from './fake-adapter.js';
import {
  LIVE_COMPATIBILITY_PROMPT,
  compareLiveCompatibilityReports,
  createLiveFixtureCandidate,
  parseLiveEnvironment,
  runLiveCompatibility,
  sanitizeLiveValue,
  validateLiveFixtureCandidate,
  validateLiveCompatibilityReport,
  type LiveCompatibilityReport,
} from './live-compatibility.js';

describe('live compatibility harness', () => {
  it('is disabled by default and enforces mutation gates', () => {
    expect(() => parseLiveEnvironment('openclaw', {})).toThrow(/disabled/i);
    const readOnly = parseLiveEnvironment('openclaw', {
      RUNTIME_LIVE_ENABLED: 'true',
      OPENCLAW_ENDPOINT: 'wss://runtime.example.test',
      LIVE_ALLOW_CHAT_RUN: 'true',
      LIVE_ALLOW_CANCELLATION: 'true',
    });
    expect(readOnly.mutationPolicy).toEqual({
      allowSessionCreation: false,
      allowRunCreation: false,
      allowCancellation: false,
      allowApproval: false,
    });
    const enabled = parseLiveEnvironment('hermes', {
      RUNTIME_LIVE_ENABLED: 'true',
      HERMES_ENDPOINT: 'https://runtime.example.test',
      LIVE_ALLOW_MUTATION: 'true',
      LIVE_ALLOW_CHAT_RUN: 'true',
      LIVE_ALLOW_CANCELLATION: 'true',
      LIVE_ALLOW_APPROVAL: 'true',
    });
    expect(enabled.mutationPolicy).toEqual({
      allowSessionCreation: true,
      allowRunCreation: true,
      allowCancellation: true,
      allowApproval: true,
    });
  });

  it('rejects embedded credentials and credential query parameters', () => {
    expect(() => parseLiveEnvironment('hermes', {
      RUNTIME_LIVE_ENABLED: 'true', HERMES_ENDPOINT: 'https://user:pass@runtime.example.test',
    })).toThrow(/network policy/i);
    expect(() => parseLiveEnvironment('openclaw', {
      RUNTIME_LIVE_ENABLED: 'true', OPENCLAW_ENDPOINT: 'wss://runtime.example.test/?token=secret',
    })).toThrow(/query/i);
  });

  it('runs checks in deterministic order and closes the adapter in finally', async () => {
    const adapter = new TrackingAdapter();
    const order: string[] = [];
    const report = await runLiveCompatibility({
      adapter,
      target: target(),
      metadata: metadata(),
      checks: ['first', 'second'].map((id) => ({
        id,
        category: 'test',
        required: true,
        destructive: false,
        async run({ state }) {
          order.push(id);
          if (id === 'first') {
            const connection = await adapter.connect({ target: { endpoint: 'https://runtime.example.test' } });
            state.set('connection', connection);
            state.set('capabilities', connection.descriptor.capabilities);
          }
        },
      })),
      now: incrementingNow(),
    });
    expect(order).toEqual(['first', 'second']);
    expect(adapter.closeCount).toBe(1);
    expect(report.summary).toEqual({ passed: 2, failed: 0, skipped: 0, requiredChecksPassed: true });
  });

  it('normalizes provider errors without retaining their messages or secrets', async () => {
    const marker = 'UNIQUE_LIVE_SECRET_MARKER';
    const adapter = new TrackingAdapter();
    const report = await runLiveCompatibility({
      adapter,
      target: target(),
      metadata: metadata(),
      checks: [{
        id: 'provider-error', category: 'security', required: true, destructive: false,
        async run() { throw new Error(`Bearer ${marker} provider leaked`); },
      }],
    });
    expect(report.summary.requiredChecksPassed).toBe(false);
    expect(JSON.stringify(report)).not.toContain(marker);
    expect(report.checks[0]?.errorCode).toBe('PROVIDER_ERROR');
  });

  it('enforces per-check timeouts and still closes the adapter', async () => {
    const adapter = new TrackingAdapter();
    const report = await runLiveCompatibility({
      adapter,
      target: target(),
      metadata: metadata(),
      checks: [{
        id: 'slow', category: 'timeouts', required: true, destructive: false, timeoutMs: 5,
        async run({ signal }) {
          await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
        },
      }],
    });
    expect(report.checks[0]?.errorCode).toBe('TIMEOUT');
    expect(report.summary.requiredChecksPassed).toBe(false);
    expect(adapter.closeCount).toBe(1);
  });

  it('sanitizes nested credentials, endpoints, paths, prompts, and identifiers', () => {
    const marker = 'UNIQUE_SANITIZER_MARKER';
    const sanitized = sanitizeLiveValue({
      authorization: `Bearer ${marker}`,
      nested: [{ api_key: marker, url: `https://user:${marker}@internal.example.test/path?token=${marker}` }],
      prompt: LIVE_COMPATIBILITY_PROMPT,
      runId: 'run-customer-123',
    }, { replaceIdentifiers: true });
    const text = JSON.stringify(sanitized);
    expect(text).not.toContain(marker);
    expect(text).not.toContain('internal.example.test');
    expect(text).not.toContain(LIVE_COMPATIBILITY_PROMPT);
    expect(text).toContain('[redacted]');
  });

  it('creates review-only sanitized fixture candidates', async () => {
    const report = await passingReport();
    const candidate = createLiveFixtureCandidate({
      report,
      payload: { run_id: 'run-sensitive-123', session_key: 'sensitive-value', text: LIVE_COMPATIBILITY_PROMPT },
    });
    expect(candidate.metadata.source).toBe('sanitized-live-candidate');
    expect(candidate.metadata.manualReviewRequired).toBe(true);
    expect(JSON.stringify(candidate.payload)).not.toContain('sensitive-value');
    expect(JSON.stringify(candidate.payload)).not.toContain(LIVE_COMPATIBILITY_PROMPT);
  });

  it('rejects malicious or oversized report and fixture artifacts', async () => {
    const report = await passingReport();
    const oversized = structuredClone(report);
    oversized.limitations = ['x'.repeat(2_100_000)];
    expect(() => validateLiveCompatibilityReport(oversized)).toThrow(/maximum size/i);
    expect(() => validateLiveFixtureCandidate({
      metadata: {
        source: 'sanitized-live-candidate', manualReviewRequired: true,
        sanitizerVersion: 'live-compatibility-v1', adapterId: 'fake', sdkCommitSha: 'abc', captureDate: report.generatedAt,
      },
      payload: { authorization: 'Bearer malicious-fixture-secret-marker' },
    })).toThrow(/secret scan/i);
  });

  it('detects capability removals and required-check regressions', async () => {
    const previous = await passingReport();
    const current: LiveCompatibilityReport = structuredClone(previous);
    current.capabilities.runs.start = false;
    current.checks = current.checks.map((check) => check.id === 'pass' ? { ...check, status: 'failed' as const, errorCode: 'INVALID_RESPONSE' } : check);
    current.summary = { passed: 0, failed: 1, skipped: 0, requiredChecksPassed: false };
    validateLiveCompatibilityReport(current);
    const diff = compareLiveCompatibilityReports(previous, current);
    expect(diff.capabilityRemovals).toContain('runs.start');
    expect(diff.newlyFailingChecks).toEqual(['pass']);
    expect(diff.breakingRegression).toBe(true);
  });

  it('rejects reports whose summaries do not match their checks', async () => {
    const report = await passingReport();
    report.summary.failed = 7;
    expect(() => validateLiveCompatibilityReport(report)).toThrow(/summary/i);
  });

  it('keeps the manual workflow protected and manual-only', async () => {
    const workflow = await readFile(new URL('../../../.github/workflows/live-compatibility.yml', import.meta.url), 'utf8');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toContain('pull_request:');
    expect(workflow).not.toMatch(/^\s+push:/m);
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain('environment: live-compatibility');
    expect(workflow).toContain('timeout-minutes:');
    expect(workflow).toContain('concurrency:');
    expect(workflow).not.toContain('packages: write');
  });
});

class TrackingAdapter extends FakeRuntimeAdapter {
  closeCount = 0;
  override async close(): Promise<void> {
    this.closeCount += 1;
    await super.close();
  }
}

function target() {
  return {
    adapterId: 'fake',
    endpoint: 'https://runtime.example.test',
    mutationPolicy: { allowSessionCreation: false, allowRunCreation: false, allowCancellation: false, allowApproval: false },
  };
}

function metadata() {
  return {
    commitSha: '0123456789abcdef',
    packageVersion: '0.1.0',
    nodeVersion: 'v22.13.0',
    platform: 'linux',
    endpointFingerprint: 'a'.repeat(64),
  };
}

async function passingReport(): Promise<LiveCompatibilityReport> {
  const adapter = new TrackingAdapter();
  return runLiveCompatibility({
    adapter,
    target: target(),
    metadata: metadata(),
    checks: [{
      id: 'pass', category: 'test', required: true, destructive: false,
      async run({ state }) {
        const connection = await adapter.connect({ target: { endpoint: 'https://runtime.example.test' } });
        state.set('connection', connection);
        state.set('capabilities', connection.descriptor.capabilities);
      },
    }],
  });
}

function incrementingNow(): () => Date {
  let value = Date.parse('2026-07-14T00:00:00.000Z');
  return () => new Date(value += 5);
}
