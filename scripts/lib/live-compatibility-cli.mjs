import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { link, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createDefaultRuntimeRegistry } from '../../packages/node/dist/index.js';
import { RuntimeError } from '../../packages/core/dist/index.js';
import {
  LIVE_COMPATIBILITY_PREFIX,
  LIVE_COMPATIBILITY_PROMPT,
  createLiveFixtureCandidate,
  formatLiveCompatibilityReport,
  parseLiveEnvironment,
  runLiveCompatibility,
  sanitizeLiveValue,
  validateLiveCompatibilityReport,
} from '../../packages/testing/dist/index.js';

export function readLiveCliConfig(provider, env = process.env, argv = process.argv.slice(2)) {
  if (argv.some((value) => /^(--token|--password|--api-key)(?:=|$)/.test(value))) {
    throw configError('Credentials are not accepted in command-line arguments');
  }
  const common = parseLiveEnvironment(provider, env);
  return {
    ...common,
    cancellationScenarioConfirmed: env.LIVE_CANCELLATION_SCENARIO_CONFIRMED === 'true',
    approvalScenarioConfirmed: env.LIVE_APPROVAL_SCENARIO === 'safe-noop',
    outputDir: resolve(env.LIVE_OUTPUT_DIR ?? 'artifacts/live-compatibility'),
    outputFormat: argv.includes('--json') || env.LIVE_OUTPUT_FORMAT === 'json' ? 'json' : 'human',
    overallTimeoutMs: positiveInt(env.LIVE_OVERALL_TIMEOUT_MS, 120_000),
    checkTimeoutMs: positiveInt(env.LIVE_CHECK_TIMEOUT_MS, 20_000),
  };
}

export async function executeLiveTarget(config, { env = process.env, writeReports = true } = {}) {
  const secrets = new MemorySecretStore();
  const auth = await resolveCredential(config, env, secrets);
  const registry = createDefaultRuntimeRegistry({
    stateStore: new MemoryStateStore(),
    secretStore: secrets,
    openclaw: config.provider === 'openclaw' ? {} : false,
    hermes: config.provider === 'hermes' ? {} : false,
  });
  const adapter = registry.create(config.provider);
  const target = {
    adapterId: config.provider,
    endpoint: config.endpoint,
    credentialRef: config.credentialRef,
    expectedProtocol: config.expectedProtocol,
    mutationPolicy: config.mutationPolicy,
  };
  const checks = buildChecks(config, auth);
  const report = await runLiveCompatibility({
    adapter,
    target,
    checks,
    metadata: {
      commitSha: sdkCommitSha(),
      packageVersion: await sdkPackageVersion(),
      nodeVersion: process.version,
      platform: process.platform,
      endpointFingerprint: endpointFingerprint(config.endpoint, config.provider),
      limitations: limitations(config),
    },
    overallTimeoutMs: config.overallTimeoutMs,
    defaultCheckTimeoutMs: config.checkTimeoutMs,
  });
  let reportPath;
  let candidatePath;
  if (writeReports) {
    const stamp = report.generatedAt.replace(/[:.]/g, '-');
    reportPath = join(config.outputDir, `${config.provider}-${stamp}.json`);
    await writeJsonAtomic(reportPath, report);
    if (config.captureFixtures) {
      const candidate = createLiveFixtureCandidate({
        report,
        payload: { descriptor: report.target, capabilities: report.capabilities, checks: report.checks },
      });
      candidatePath = join(config.outputDir, 'fixture-candidates', `${config.provider}-${stamp}.candidate.json`);
      await writeJsonAtomic(candidatePath, candidate);
    }
  }
  return { report, reportPath, candidatePath };
}

export function validateLiveEndpoint(endpoint, provider) {
  parseLiveEnvironment(provider, {
    RUNTIME_LIVE_ENABLED: 'true',
    [provider === 'openclaw' ? 'OPENCLAW_ENDPOINT' : 'HERMES_ENDPOINT']: endpoint,
  });
  return true;
}

export async function writeJsonAtomic(path, value) {
  const safeValue = sanitizeLiveValue(value);
  if (safeValue && typeof safeValue === 'object' && safeValue.schemaVersion === 1) validateLiveCompatibilityReport(safeValue);
  const output = `${JSON.stringify(safeValue, null, 2)}\n`;
  if (Buffer.byteLength(output) > 2_000_000) throw configError('Live artifact exceeded its maximum size');
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, output, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  try {
    await link(temp, path);
  } finally {
    await unlink(temp).catch(() => undefined);
  }
}

export async function readReport(path) {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > 2_000_000) throw configError('Live report input exceeded its maximum size');
  const value = JSON.parse(await readFile(path, 'utf8'));
  validateLiveCompatibilityReport(value);
  return value;
}

export function safeOutput(result, format) {
  if (format === 'json') return `${JSON.stringify(sanitizeLiveValue(result.report), null, 2)}\n`;
  const paths = [result.reportPath, result.candidatePath]
    .filter(Boolean)
    .map((value) => basename(value));
  return `${formatLiveCompatibilityReport(result.report)}${paths.length ? `\nartifacts: ${paths.join(', ')}` : ''}\n`;
}

function buildChecks(config, auth) {
  return [
    {
      id: 'network-policy', category: 'connection', required: true, destructive: false,
      async run() { validateLiveEndpoint(config.endpoint, config.provider); },
    },
    {
      id: 'connect', category: 'connection', required: true, destructive: false,
      async run({ adapter, target, signal, state }) {
        const options = config.provider === 'openclaw' && target.expectedProtocol
          ? { protocolVersions: [Number(target.expectedProtocol)] }
          : undefined;
        const connection = await adapter.connect({
          target: { endpoint: target.endpoint },
          credentialRef: config.provider === 'hermes' ? target.credentialRef : undefined,
          auth,
          options,
        }, { signal });
        if (target.expectedProtocol && connection.descriptor.protocolVersion !== target.expectedProtocol) {
          throw runtimeError('PROTOCOL_MISMATCH', 'The runtime selected a different protocol');
        }
        state.set('connection', connection);
        return { status: 'passed', message: 'runtime connection and protocol negotiation succeeded' };
      },
    },
    {
      id: 'capabilities', category: 'capabilities', required: true, destructive: false,
      async run({ adapter, state }) {
        const capabilities = await adapter.capabilities();
        state.set('capabilities', capabilities);
        return { status: 'passed', message: 'normalized capabilities were validated' };
      },
    },
    {
      id: 'health', category: 'health', required: true, destructive: false,
      async run({ adapter, signal, state }) {
        const health = await adapter.health({ signal });
        if (health.status === 'unavailable') throw runtimeError('PROVIDER_UNAVAILABLE', 'Runtime health is unavailable', true);
        state.set('health', health);
        return { status: 'passed', message: `runtime health is ${health.status}`, safeDetails: { status: health.status, details: health.details } };
      },
    },
    {
      id: 'controlled-run', category: 'mutation', required: false, destructive: true,
      timeoutMs: 60_000,
      async run(context) {
        if (!config.mutationPolicy.allowRunCreation) return { status: 'skipped', message: 'mutation is disabled' };
        return controlledRun(context);
      },
    },
    {
      id: 'controlled-cancellation', category: 'cancellation', required: false, destructive: true,
      timeoutMs: 45_000,
      async run(context) {
        if (!config.mutationPolicy.allowCancellation) return { status: 'skipped', message: 'cancellation mutation is disabled' };
        if (!config.cancellationScenarioConfirmed) return { status: 'skipped', message: 'no safe deterministic cancellation scenario is configured' };
        return controlledCancellation(context);
      },
    },
    {
      id: 'controlled-approval', category: 'approvals', required: false, destructive: true,
      async run() {
        if (!config.mutationPolicy.allowApproval) return { status: 'skipped', message: 'approval mutation is disabled' };
        if (!config.approvalScenarioConfirmed) return { status: 'skipped', message: 'no safe live approval scenario is configured' };
        return { status: 'skipped', message: 'safe approval trigger is not available through the provider-neutral text-run contract' };
      },
    },
    {
      id: 'clean-disconnect', category: 'resources', required: true, destructive: false,
      async run({ adapter }) {
        await adapter.close();
        return { status: 'passed', message: 'adapter closed cleanly' };
      },
    },
  ];
}

async function controlledRun({ adapter, signal, state }) {
  const capabilities = state.get('capabilities') ?? await adapter.capabilities();
  if (!capabilities.runs?.start || !capabilities.input?.text) return { status: 'skipped', message: 'text runs are not advertised' };
  const suffix = randomUUID();
  const applicationSessionId = `${LIVE_COMPATIBILITY_PREFIX}session-${suffix}`;
  const applicationRunId = `${LIVE_COMPATIBILITY_PREFIX}run-${suffix}`;
  const session = await adapter.ensureSession({ applicationSessionId, title: 'Banzae SDK compatibility validation' }, { signal });
  const run = await adapter.startRun({
    applicationRunId,
    idempotencyKey: `${LIVE_COMPATIBILITY_PREFIX}${suffix}`,
    session,
    input: { text: LIVE_COMPATIBILITY_PROMPT },
    instructions: 'Return only the requested marker. Do not use tools or perform external actions.',
  }, { signal });
  let output = '';
  let terminalCount = 0;
  if (capabilities.runs.stream) {
    for await (const event of adapter.streamRun({
      applicationRunId,
      externalRunId: run.externalRunId,
      externalSessionId: session.externalSessionId,
      providerState: run.providerState,
    }, { signal })) {
      if (event.type === 'assistant.delta') output += event.delta;
      if (event.type === 'assistant.completed') output = event.text;
      if (['run.completed', 'run.failed', 'run.cancelled'].includes(event.type)) terminalCount += 1;
    }
    if (terminalCount !== 1) throw runtimeError('INVALID_RESPONSE', 'Controlled run did not emit exactly one terminal event');
  }
  const snapshot = await adapter.getRun({
    applicationRunId,
    externalRunId: run.externalRunId,
    externalSessionId: session.externalSessionId,
    providerState: run.providerState,
  }, { signal });
  output = snapshot.output ?? output;
  if (!output.includes('BANZAE_RUNTIME_COMPATIBILITY_OK')) throw runtimeError('INVALID_RESPONSE', 'Controlled run output marker was not observed');
  if (capabilities.sessions.history) {
    await adapter.getHistory({
      applicationSessionId,
      externalSessionId: session.externalSessionId,
      providerState: session.providerState,
      limit: 10,
    }, { signal });
  }
  state.set('controlledRun', { applicationRunId, externalRunId: run.externalRunId, externalSessionId: session.externalSessionId });
  return { status: 'passed', message: 'controlled text run completed with the expected marker' };
}

async function controlledCancellation({ adapter, signal, state, target }) {
  const capabilities = state.get('capabilities') ?? await adapter.capabilities();
  if (!capabilities.runs?.cancel) return { status: 'skipped', message: 'run cancellation is not advertised' };
  const suffix = randomUUID();
  const applicationSessionId = `${LIVE_COMPATIBILITY_PREFIX}cancel-session-${suffix}`;
  const session = await adapter.ensureSession({ applicationSessionId }, { signal });
  const run = await adapter.startRun({
    applicationRunId: `${LIVE_COMPATIBILITY_PREFIX}cancel-run-${suffix}`,
    idempotencyKey: `${LIVE_COMPATIBILITY_PREFIX}cancel-${suffix}`,
    session,
    input: { text: 'Compatibility cancellation check. Do not use tools or perform external actions.' },
  }, { signal });
  await adapter.cancelRun({
    applicationRunId: run.applicationRunId,
    externalRunId: run.externalRunId,
    externalSessionId: session.externalSessionId,
  }, { signal, timeoutMs: 10_000 });
  const deadline = Date.now() + 20_000;
  let status = run.status;
  while (Date.now() < deadline && !['completed', 'failed', 'cancelled'].includes(status)) {
    await abortableDelay(500, signal);
    const snapshot = await adapter.getRun({
      applicationRunId: run.applicationRunId,
      externalRunId: run.externalRunId,
      externalSessionId: session.externalSessionId,
    }, { signal });
    status = snapshot.status;
  }
  if (status !== 'cancelled') throw runtimeError('OUTCOME_UNKNOWN', 'Controlled cancellation did not reach provider-confirmed cancelled state', true);
  if (target.adapterId === 'hermes') {
    await adapter.cancelRun({
      applicationRunId: run.applicationRunId,
      externalRunId: run.externalRunId,
      externalSessionId: session.externalSessionId,
    }, { signal, timeoutMs: 10_000 });
  }
  return { status: 'passed', message: 'controlled run reached provider-confirmed cancelled state' };
}

async function resolveCredential(config, env, secrets) {
  if (!config.credentialRef) return { kind: 'none' };
  const name = config.credentialRef.slice('env:'.length);
  if (!name || !/^[A-Z_][A-Z0-9_]*$/.test(name)) throw configError('Credential reference environment name is invalid');
  const value = env[name];
  if (!value) throw configError('Credential reference could not be resolved');
  await secrets.set(config.credentialRef, { value });
  return config.provider === 'hermes' ? { kind: 'bearer', token: value } : { kind: 'token', token: value };
}

function limitations(config) {
  const values = ['Live checks are read-only unless every required mutation gate is enabled.'];
  if (!config.mutationPolicy.allowRunCreation) values.push('Controlled run validation was not enabled.');
  if (!config.mutationPolicy.allowCancellation) values.push('Controlled cancellation validation was not enabled.');
  if (!config.mutationPolicy.allowApproval || !config.approvalScenarioConfirmed) values.push('No safe live approval scenario was validated.');
  if (config.provider === 'hermes') values.push('Hermes previous_response_id successor advancement is not claimed.');
  values.push('Transport listener and pending-request counters are not public live-adapter APIs; cleanup is asserted through bounded operations and adapter close.');
  values.push('Provider event inventories are not public descriptor fields; normalized streaming capabilities are reported instead.');
  return values;
}

function endpointFingerprint(endpoint, provider) {
  const url = new URL(endpoint.replace(/^openclaw\+/, '').replace(/^hermes\+/, ''));
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return createHash('sha256').update(`${provider}:${url.toString()}`).digest('hex');
}

function sdkCommitSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'unknown';
  }
}

async function sdkPackageVersion() {
  try {
    const manifest = JSON.parse(await readFile(new URL('../../packages/core/package.json', import.meta.url), 'utf8'));
    return typeof manifest.version === 'string' ? manifest.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

function positiveInt(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw configError('Timeout values must be positive integers');
  return parsed;
}

function configError(message) {
  const error = new Error(message);
  error.code = 'INVALID_CONFIGURATION';
  return error;
}

function runtimeError(code, message, retryable = false) {
  return new RuntimeError({ code, message, retryable });
}

function abortableDelay(ms, signal) {
  return new Promise((resolveDelay, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolveDelay, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

class MemorySecretStore {
  #values = new Map();
  async get(ref) { return this.#values.get(ref) ?? null; }
  async set(ref, value) { this.#values.set(ref, value); }
}

class MemoryStateStore {
  #values = new Map();
  async get(namespace, key) { return this.#values.get(`${namespace}:${key}`) ?? null; }
  async set(namespace, key, value) { this.#values.set(`${namespace}:${key}`, value); }
  async delete(namespace, key) { this.#values.delete(`${namespace}:${key}`); }
}
