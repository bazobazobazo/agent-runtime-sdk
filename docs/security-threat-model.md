# Security Threat Model

## Scope and assumptions

The SDK connects a trusted host application to a potentially malicious runtime
over injected HTTP or WebSocket transports. Protocol data, endpoint URLs,
credential-provider failures, fixtures, and generated artifacts are untrusted.
Host authorization, tenant isolation, and infrastructure policy are outside the
generic transport SDK.

## Trust boundaries

| Boundary | Principal risks | SDK protection | External owner |
|---|---|---|---|
| SDK consumer → SDK | invalid IDs, unsafe headers, unsupported attachments, uncertain retry | input/capability validation, exact idempotency keys, normalized outcomes | host authorizes the caller and persists idempotency |
| SDK → runtime endpoint | SSRF, redirects, downgrade, credential disclosure | scheme/userinfo/query validation, redirects off, injectable network policy | host/infrastructure controls DNS, egress, proxy, TLS |
| Runtime endpoint → SDK | malformed/oversized/deep payloads, deceptive capability data, event floods | strict schemas, fail-closed capabilities, byte/depth/queue/dedupe limits | runtime operator secures service |
| Credential provider → adapter | rejected/slow resolution, malicious messages | required providers, bounded operation timeout, generic errors, sanitization | host secures credential store and access policy |
| Network transport → parser | truncation, invalid UTF-8, endless streams, sequence manipulation | fatal decoding, explicit schemas, bounded parsers, cancellation and cleanup | transport implementation enforces TLS/payload limits |
| Parser → normalized events | unknown terminal-like names, ID confusion, duplicate events | explicit event allowlists, correlation, sequence gaps, bounded dedupe | consumer reconciles documented gaps |
| Live artifacts / fixture candidates | credentials, customer data, internal paths, malicious filenames | recursive sanitization, schema/size scan, atomic no-overwrite writes | human reviewer approves evidence |
| Testing fake servers | misleading compatibility claims, retained resources | clearly synthetic classification and deterministic counters | maintainer keeps fake/live evidence distinct |
| Package build/publication | dependency compromise, secret/path leakage, archive tampering | lockfile, audit, CodeQL, SBOM, artifact/package scan | release operator protects publishing authority |

## Threats and mitigations

- Malicious endpoints may send malformed JSON, frames, invalid UTF-8, deep
  structures, duplicate events, sequence gaps, huge bodies, endless keepalives,
  or event floods. Production parsers validate explicit shapes and enforce the
  centralized limits documented in `security.md`.
- Deceptive capabilities and manifests fail closed. Generic HTTP/WebSocket
  success is not runtime identity. Detection never sends a prompt, starts a run,
  creates a schedule, or writes files, and aborts losing probes before return.
- Redirect abuse is blocked by zero redirects. HTTPS-to-HTTP and cross-host
  redirects are rejected. Runtime URL userinfo and credential-like query keys
  are rejected; fingerprints omit queries and credential references.
- Credential and provider-message leakage is reduced through bounded recursive
  sanitization, normalized public messages, raw-payload opt-in, report/fixture
  scanning, and build/tarball inspection.
- Denial of service is bounded by body, frame, line, event, pending-buffer,
  subscriber, dedupe, timeout, reconnect, reconciliation, diagnostic, and
  artifact limits. Caller abort and adapter close terminate active operations.
- Uncertain side effects use `OUTCOME_UNKNOWN` only after a run request might
  have been accepted. The adapter does not replay with a different idempotency
  key.
- Dependency and workflow compromise are addressed through lockfile checks,
  high-severity dependency review/audit, minimal workflow permissions, CodeQL,
  SBOMs, secret scans, and package allowlists.

## Ownership boundaries

The SDK owns protocol validation, cancellation, resource cleanup, normalized
errors/events, and safe defaults. The host application owns endpoint authority,
tenant/user authorization, durable state, credential lifecycle, retry policy,
and approval authorization. A later BanzaeForge integration may add product
network/tenant policy and audit persistence. Infrastructure owns DNS, metadata
service protection, egress/proxy policy, TLS trust, and runtime isolation.

Private runtimes are a supported deployment model, so the SDK does not globally
deny RFC1918, loopback, or other private addresses. That decision must be made
with deployment-aware DNS and network information by the host or infrastructure.
