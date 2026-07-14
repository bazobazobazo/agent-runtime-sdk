# @banzae/agent-runtime-core

Provider-neutral runtime contracts, capability types, events, errors, registry
helpers, and dependency ports for Banzae agent runtime adapters.

This package has no Node-only runtime dependency.

The root entrypoint is the stable-for-alpha provider-neutral contract.
`/diagnostics` contains bounded sanitizers, `/experimental` contains unstable
adapter-authoring helpers, and `/testing` contains test ports and deterministic
dependencies. Applications should not deep-import `dist` or `src` files.

Adapters expose the shared `created -> connecting -> connected -> closing ->
closed` lifecycle. Timestamps are ISO-8601 UTC strings; timeout configuration is
numeric milliseconds. See `docs/public-api.md` and the generated `etc/api`
reports.
