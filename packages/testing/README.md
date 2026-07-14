# @banzae/agent-runtime-testing

Reusable provider-neutral conformance definitions and testing-only fake runtime
controllers for Banzae agent runtime adapters.

## Shared conformance

`createRuntimeAdapterConformanceSuite()` returns test-runner-independent named
cases. A Vitest adapter is only a few lines:

```ts
const suite = createRuntimeAdapterConformanceSuite({
  name: 'Example Runtime',
  createTarget: () => targetHarness(),
  createAdapter: (target) => createExampleAdapter(target.dependencies),
  expectedCapabilities,
  scenarios: {
    session: () => ({ applicationSessionId: 'application-session' }),
    run: (_target, session) => ({
      applicationRunId: 'application-run',
      idempotencyKey: 'caller-key',
      session,
      input: { text: 'hello' },
    }),
  },
});

describe(suite.name, () => {
  for (const testCase of suite.cases) {
    it(`[${testCase.category}] ${testCase.name}`, testCase.run);
  }
});
```

The shared cases call only `AgentRuntimeAdapter` and provider-neutral input and
output types. Fake controller hooks may inject wire events or inspect resource
counters, but they never inspect adapter internals.

## Included test utilities

- separate `FakeOpenClawV3Server` and `FakeOpenClawV4Server` Gateway
  controllers with version-owned challenge, hello, response, event, history,
  and cancellation shapes;
- `FakeHermesServer` for capabilities, health, Runs HTTP/SSE, reconciliation,
  approvals, cancellation, REST sessions, and history;
- deterministic clock and ID generator;
- secret marker and resource-release assertions;
- a lightweight `FakeRuntimeAdapter` for testing the conformance API itself.

Fake servers are testing-only. They contain synthetic values and prove SDK
behavior against controlled protocol evidence; they do not prove compatibility
with a live runtime release.

See `docs/adapter-conformance.md` for the complete contract and adapter-author
workflow.
