# Versioning and compatibility

## Alpha API contract

The public TypeScript API is frozen only for `v0.1.0-alpha.1`. This is not a
stable `1.0` or production-final promise. Breaking `0.x` changes require an API
report update and migration note. Experimental/testing entrypoints can change
more frequently.

Keep these version domains separate:

- SDK package version;
- adapter version;
- wire protocol name/version;
- runtime product/version;
- evidence/report schema version.

## Evidence model

Compatibility claims may be backed by inspected provider source, sanitized
fixtures, deterministic fake servers, conformance tests, or opt-in live reports.
Each claim must name its evidence. Synthetic evidence does not become live
evidence by implication.

Current summary:

- OpenClaw wire protocols v3 and v4 are implemented.
- Hermes Runs HTTP/SSE is implemented and fake-server validated.
- Full live Hermes run/stream/approval/cancellation validation remains pending.

See [Compatibility](compatibility.md) for pinned targets and
[Live compatibility](live-compatibility.md) for the gated evidence workflow.
