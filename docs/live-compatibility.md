# Live Runtime Compatibility

The live compatibility harness validates a real OpenClaw or Hermes runtime
through the public SDK adapter interface. It is opt-in, read-only by default,
and separate from ordinary pull-request CI. Building the harness does not
contact a runtime and does not change any compatibility claim.

## Safety model

Set `RUNTIME_LIVE_ENABLED=true` for every invocation. Session or run creation
also requires `LIVE_ALLOW_MUTATION=true`; a text run additionally requires
`LIVE_ALLOW_CHAT_RUN=true`. Cancellation and approval have independent gates.
The fixed run prompt is:

```text
Reply with exactly: BANZAE_RUNTIME_COMPATIBILITY_OK
```

The CLI does not accept tokens, passwords, arbitrary prompts, or tool arguments
as command-line flags. Credentials use environment-backed references such as
`env:OPENCLAW_GATEWAY_TOKEN` and `env:HERMES_API_TOKEN`. Approval validation is
skipped unless a documented safe scenario is configured. Cancellation is
skipped unless the operator confirms that a deterministic cancellable scenario
exists.

The harness rejects URL userinfo and credential-like query parameters. Before
printing or writing, it recursively removes credentials, cookies, session keys,
device tokens, signatures, JWT-like strings, endpoint URLs, internal paths,
raw payloads, prompts, and sensitive tool arguments. A final report-level scan
fails closed if suspicious values remain.

## Commands

Read-only OpenClaw:

```bash
RUNTIME_LIVE_ENABLED=true \
OPENCLAW_ENDPOINT=wss://runtime.example.invalid \
OPENCLAW_CREDENTIAL_REF=env:OPENCLAW_GATEWAY_TOKEN \
OPENCLAW_GATEWAY_TOKEN='<scoped secret in the environment>' \
OPENCLAW_PROTOCOL=auto \
pnpm live:openclaw
```

Read-only Hermes:

```bash
RUNTIME_LIVE_ENABLED=true \
HERMES_ENDPOINT=https://runtime.example.invalid \
HERMES_CREDENTIAL_REF=env:HERMES_API_TOKEN \
HERMES_API_TOKEN='<scoped secret in the environment>' \
pnpm live:hermes
```

`pnpm live:compatibility` runs every configured target. Add `--json` for JSON
console output. Reports are atomically written under
`artifacts/live-compatibility/`, which is ignored by Git.

Controlled text-run validation requires:

```bash
LIVE_ALLOW_MUTATION=true
LIVE_ALLOW_CHAT_RUN=true
```

Cancellation additionally requires `LIVE_ALLOW_CANCELLATION=true` and
`LIVE_CANCELLATION_SCENARIO_CONFIRMED=true`. Approval requires
`LIVE_ALLOW_APPROVAL=true` and a reviewed safe scenario. These checks are
optional and recorded as skipped when their safety preconditions are absent.
In the protected workflow, selecting the cancellation input is the explicit
scenario confirmation. A protected environment variable may name a reviewed
approval scenario; the harness still skips when no provider-neutral safe trigger
is available.

## Reports and evidence

Schema version 1 reports contain the SDK commit and version, Node/platform
metadata, an endpoint fingerprint, runtime and protocol identity, normalized
capabilities, ordered check results, a required-check summary, and limitations.
They never contain complete endpoint URLs, query strings, headers, credentials,
customer prompts, or raw provider payloads.
Reports and fixture candidates are limited to 2,000,000 serialized bytes by
default. Inputs are size-checked before parse, output is secret-scanned before
write, writes use an atomic no-overwrite link, and malformed or excessive
reports fail closed.

Passing read-only checks proves that the recorded runtime was reachable and
that its handshake/capabilities/health behavior matched the SDK at the stated
commit. Mutation checks prove only the explicitly enabled controlled
operations. A report does not prove behavior that was skipped, future runtime
versions, production policy compatibility, or safety of arbitrary prompts and
tools.

Evidence labels are:

- synthetic fixture validated;
- fake-server conformance validated;
- sanitized live validated;
- live validation pending;
- unsupported;
- implementation pending.

Only a reviewed sanitized live report can move a specific runtime version to
`sanitized live validated`.

## Fixture candidates

Set `LIVE_CAPTURE_FIXTURES=true` to stage a recursively sanitized candidate in
`artifacts/live-compatibility/fixture-candidates/`. Candidates use deterministic
run/session placeholders, declare `source: sanitized-live-candidate`, and set
`manualReviewRequired: true`. Run `pnpm live:fixtures` to validate staged
candidates. No command copies candidates into committed fixture directories;
human review is mandatory.

## Report comparison

```bash
pnpm live:compare old-report.json new-report.json
pnpm live:compare old-report.json new-report.json --json
```

Comparison reports runtime/protocol version changes, capability additions and
removals, newly failing checks, required checks that became skipped, and error
classification changes. Capability removals and required-check regressions
produce a nonzero exit code. Raw provider data is never compared.

## Manual GitHub workflow

`.github/workflows/live-compatibility.yml` runs only through
`workflow_dispatch` in the protected `live-compatibility` environment. It has
`contents: read`, bounded execution time, per-target concurrency, explicit
mutation inputs, short artifact retention, and cleanup that always runs. It has
no package publication permission and is never triggered by pushes or pull
requests.

Normal CI builds and tests the harness against fake OpenClaw v3, OpenClaw v4,
and Hermes runtimes. It makes no external runtime calls and requires no live
credentials.
