# @banzae/agent-runtime-node

Node.js facade and default dependency implementations for the Banzae Agent
Runtime SDK.

Includes registry construction, fetch/WebSocket transports, file state storage,
in-memory secret storage, and Node crypto helpers.

`EnvironmentRuntimeCredentialProvider` resolves only `env:VARIABLE` references;
credential values are never accepted as CLI arguments. This ESM-only package
requires Node.js `>=22.13` and intentionally does not export provider parser or
dispatcher internals.
