export {
  RuntimeRegistry,
  type RuntimeAdapterDependencies,
  type RuntimeSecretStore,
  type RuntimeStateStore,
} from '@banzae/agent-runtime-core';
export { detectRuntime } from '@banzae/agent-runtime-detection';
export { createHermesAdapterFactory } from '@banzae/agent-runtime-hermes';
export { createOpenClawAdapterFactory } from '@banzae/agent-runtime-openclaw';
export { nodeCrypto } from './crypto.js';
export { NodeFileStateStore, NodeMemorySecretStore } from './stores.js';
export { FetchHttpTransport, WsWebSocketFactory } from './transports.js';
export {
  EnvironmentRuntimeCredentialProvider,
  type EnvironmentCredentialProviderOptions,
} from './credentials.js';

import {
  RuntimeRegistry,
  IncrementingIdGenerator,
  noopLogger,
  systemClock,
  type RuntimeAdapterDependencies,
  type RuntimeLogger,
  type RuntimeSecretStore,
  type RuntimeStateStore,
} from '@banzae/agent-runtime-core';
import { createHermesAdapterFactory, type HermesAdapterOptions } from '@banzae/agent-runtime-hermes';
import { createOpenClawAdapterFactory, type OpenClawAdapterOptions } from '@banzae/agent-runtime-openclaw';
import { nodeCrypto } from './crypto.js';
import { FetchHttpTransport, WsWebSocketFactory } from './transports.js';

/** Public alpha contract for create node runtime registry options. */
export type CreateNodeRuntimeRegistryOptions = {
  stateStore: RuntimeStateStore;
  secretStore: RuntimeSecretStore;
  logger?: RuntimeLogger;
  openclaw?: OpenClawAdapterOptions | false;
  hermes?: HermesAdapterOptions | false;
};

/** Public alpha contract for create default runtime registry. */
export function createDefaultRuntimeRegistry(options: CreateNodeRuntimeRegistryOptions): RuntimeRegistry {
  const dependencies: RuntimeAdapterDependencies = {
    state: options.stateStore,
    secrets: options.secretStore,
    logger: options.logger ?? noopLogger,
    clock: systemClock,
    ids: new IncrementingIdGenerator(),
    http: new FetchHttpTransport(),
    webSockets: new WsWebSocketFactory(),
    crypto: nodeCrypto,
  };
  const registry = new RuntimeRegistry(dependencies);
  if (options.openclaw !== false) registry.register(createOpenClawAdapterFactory(options.openclaw));
  if (options.hermes !== false) registry.register(createHermesAdapterFactory(options.hermes));
  return registry;
}
