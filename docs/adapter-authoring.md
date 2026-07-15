# Adapter authoring guide

Future adapters implement `AgentRuntimeAdapter` and keep provider wire details
inside their package. Normal applications consume only provider-neutral root
exports. An optional `/experimental` entrypoint may expose explicitly unstable
adapter-authoring utilities; it is not an application escape hatch.

## Required behavior

- lifecycle: `created -> connecting -> connected -> closing -> closed`;
- fail-closed capabilities and health before connection;
- separate application/provider IDs and ISO-8601 UTC timestamps;
- caller-owned idempotency keys and conservative `OUTCOME_UNKNOWN` handling;
- strict schema validation and normalized `RuntimeError` failures;
- bounded stream parsing, queues, deduplication, retries, and reconciliation;
- abort propagation and deterministic cleanup in `close()`;
- unsupported attachments rejected before provider activity;
- no raw wire payloads in normal API, logs, or errors.

## Package boundary

Export the adapter/factory and documented adapter options from the root. Do not
export private codecs, transports, parsers, dispatchers, credential material,
or provider payload types as stable application API. Add an explicit export map
and verify packed consumers cannot deep-import internals.

## Evidence workflow

1. Add sanitized fixtures with provenance and schema validation.
2. Add deterministic fake server coverage for success, errors, cancellation,
   concurrency, malformed traffic, and cleanup.
3. Run `createRuntimeAdapterConformanceSuite()` from the testing package.
4. Add fuzz/resilience cases and resource guardrails.
5. Use the opt-in live harness; do not contact external runtimes in normal CI.
6. Update compatibility claims only to the evidence actually collected.

The runnable [`adapter-authoring` example](../examples/adapter-authoring/index.ts)
shows public conformance setup. See [Adapter conformance](adapter-conformance.md),
[Security](security.md), and [Versioning](versioning-and-compatibility.md).
