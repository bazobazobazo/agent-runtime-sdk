/** Testing-only deterministic ports. Do not use these as production infrastructure. */
export {
  MemoryStateStore,
  MemorySecretStore,
  noopLogger,
  systemClock,
  IncrementingIdGenerator,
  unavailableHttpTransport,
  unavailableWebSocketFactory,
  deterministicCrypto,
  createTestDependencies,
} from './test-ports.js';
export { TEXT_RUN_CAPABILITIES } from './capabilities.js';
