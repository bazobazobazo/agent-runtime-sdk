# Runnable examples

All examples use public package entrypoints, create an `AbortController`, close
adapters in `finally`, and normalize failures as `RuntimeError`. Normal CI uses
only deterministic fakes or construction-only adapters and never contacts an
external runtime.

| Example | Purpose | Network behavior |
|---|---|---|
| `openclaw-chat` | Explicit OpenClaw adapter selection | Construction only |
| `hermes-chat` | Explicit Hermes adapter selection | Construction only |
| `detect-runtime` | Auto-detection with a deterministic probe | Fake only |
| `lifecycle` | Connect, session, and run lifecycle | Fake only |
| `streaming` | Normalized event iteration | Fake only |
| `approvals` | Structured approval resolution | Fake only |
| `cancellation` | Caller cancellation transport contract | Fake only |
| `history` | Provider-neutral session history | Fake only |
| `credential-provider` | Environment-backed credential references | In-memory example value |
| `network-policy` | Endpoint validation | Validation only |
| `diagnostics` | Bounded diagnostic sanitization | None |
| `adapter-authoring` | Future adapter conformance setup | Fake only |

Run:

```bash
pnpm examples:typecheck
pnpm examples:test
```

Real endpoints and credentials belong only in the opt-in live compatibility
harness described in [`../docs/live-compatibility.md`](../docs/live-compatibility.md).
