/** Testing-only package. Fake runtimes do not prove live compatibility. */
export * from './contract.js';
export {
  DeterministicRuntimeClock,
  DeterministicRuntimeIdGenerator,
  createSecretMarker,
  assertSecretMarkersAbsent,
} from './deterministic.js';
export { FakeRuntimeAdapter } from './fake-adapter.js';
export { FakeHermesServer, type FakeHermesRun } from './fake-hermes-server.js';
export {
  FakeOpenClawV3Server,
  FakeOpenClawV4Server,
  type FakeOpenClawServerOptions,
  type FakeOpenClawFailureMode,
  type FakeOpenClawRun,
} from './fake-openclaw-server.js';
export {
  LIVE_COMPATIBILITY_PREFIX,
  LIVE_COMPATIBILITY_PROMPT,
  LIVE_COMPATIBILITY_REPORT_SCHEMA_VERSION,
  LIVE_FIXTURE_SANITIZER_VERSION,
  assertNoLiveReportSecrets,
  createLiveFixtureCandidate,
  formatLiveCompatibilityReport,
  parseLiveEnvironment,
  runLiveCompatibility,
  sanitizeLiveValue,
  validateLiveEndpoint,
  validateLiveFixtureCandidate,
  validateLiveCompatibilityReport,
  compareLiveCompatibilityReports,
  type LiveCompatibilityCheck,
  type LiveCompatibilityCheckContext,
  type LiveCompatibilityDiff,
  type LiveCompatibilityReport,
  type LiveCompatibilityReportMetadata,
  type LiveCompatibilityTarget,
  type LiveCheckResult,
  type LiveEnvironmentConfig,
  type LiveFixtureCandidate,
  type LiveMutationPolicy,
  type LiveProvider,
  type RunLiveCompatibilityOptions,
} from './live-compatibility.js';
