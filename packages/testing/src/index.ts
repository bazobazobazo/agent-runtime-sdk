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
  LIVE_COMPATIBILITY_PROMPT,
  runLiveCompatibility,
  validateLiveCompatibilityReport,
  compareLiveCompatibilityReports,
  type LiveCompatibilityReport,
  type LiveCompatibilityTarget,
  type LiveCheckResult,
  type LiveMutationPolicy,
} from './live-compatibility.js';
