# Security

Runtime credentials grant execution authority. Treat runtime endpoints and every
provider payload as untrusted, even when the endpoint is operated internally.
The complete trust-boundary and ownership analysis is in
`security-threat-model.md`.

## SDK guarantees

The SDK validates schemes, rejects URL userinfo and credential-like query
parameters, does not follow redirects, and rejects cross-host or HTTPS-to-HTTP
redirects at policy boundaries. It validates provider JSON and protocol frames,
bounds bodies, frames, SSE buffers, subscriber queues, deduplication, retry
loops, reconciliation, diagnostics, fixture candidates, and live reports.

Credentials resolve through injected stores/providers. Runtime errors,
diagnostics, raw payloads, fixture candidates, and compatibility reports pass
through bounded recursive sanitization. Raw provider payloads are disabled by
default. Public errors never include provider response bodies, raw headers,
complete endpoint URLs, unsafe causes, or provider messages verbatim.

Diagnostics are observational. Exceptions thrown by a host diagnostic callback
are isolated and cannot fail a runtime operation.

## Secure defaults

| Limit | Default | Hard maximum |
|---|---:|---:|
| JSON body | 1,000,000 bytes | 16,000,000 bytes |
| HTTP headers | 32,000 bytes | 256,000 bytes |
| WebSocket frame | 1,000,000 bytes | 16,000,000 bytes |
| SSE line | 64,000 bytes | 1,000,000 bytes |
| SSE event / pending buffer | 1,000,000 bytes | 8,000,000 bytes |
| Raw diagnostic depth | 8 | 32 |
| Raw object keys | 1,000 | 10,000 |
| Diagnostic array items | 100 | 10,000 |
| Diagnostic string | 4,000 characters | 64,000 characters |
| Redirects | 0 | 0 |
| OpenClaw subscriber queue | 256 frames | 8,192 frames |
| Per-run deduplication | 1,024 entries | 100,000 entries |
| Reconnect attempts | 2 | 10 |
| Reconciliation | 30 seconds | 300 seconds |
| Error details | 64,000 bytes | 1,000,000 bytes |
| Fixture candidate / live report | 2,000,000 bytes | 16,000,000 bytes |

Configurable limits must be safe integers within their hard maximum. Zero,
negative, fractional, and excessive values fail with `INVALID_CONFIGURATION`,
except the deliberately zero redirect policy and options explicitly documented
as allowing zero.

## Network and SSRF responsibility

The generic SDK deliberately permits private network targets because many agent
runtimes are private. The host application must decide which tenants may choose
endpoints and should consider DNS resolution policy, private-address controls,
cloud metadata protection, proxy policy, egress allowlists, TLS trust roots, and
certificate pinning. Do not assume a hostname remains on the same address after
validation. A custom `RuntimeNetworkPolicy` may enforce environment-specific
allowlists and denylists without adding product infrastructure to the SDK.

## Fuzzing and resource tests

`pnpm test:fuzz` runs deterministic bounded properties in the normal release
gate. Failures report the fast-check seed, path, and minimized counterexample.
`pnpm test:fuzz:extended` runs the same offline corpus with 5,000 cases and is
available manually and on a credential-free schedule. `pnpm test:resilience`
exercises 10,000 RPC/event operations, 1,000 aborts, reverse response ordering,
queue overflow, close races, repeated detection, and deterministic resource
counters. Performance ceilings are generous quadratic-regression guardrails,
not benchmarks.

## Fixtures, reports, and builds

Committed fixtures require schema and source metadata. Synthetic fixtures may
not claim a validated runtime version. Sanitized live candidates remain in an
ignored staging directory, require manual review, and cannot overwrite
committed fixtures. Live reports are schema-validated, size-limited,
secret-scanned, atomically written, and contain endpoint fingerprints rather
than URLs.

Normal CI runs secret scanning, fixture validation, artifact inspection,
license consistency, dependency review, dependency audit, CodeQL, SBOM
generation, package allowlist checks, fuzzing, and release-gate validation. It
does not contact live runtimes, publish packages, or create releases.
All third-party workflow actions are pinned to reviewed immutable commit SHAs;
version comments record the intended upstream release.

See `SECURITY.md` for private vulnerability reporting.
