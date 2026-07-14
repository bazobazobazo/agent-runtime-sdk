# Migration: Pre-alpha API Freeze

These packages were not published before this freeze, so accidental names were
removed rather than retained as aliases.

- `runs.streamText` becomes `runs.stream`; `streamTools` is removed. Health
  support is explicit under `capabilities.health`.
- `approval.requested` becomes `approval.required`.
- Event `raw` becomes `sanitizedRawPayload`.
- `getHistory()` returns `{ messages, nextCursor? }`, not a bare array.
- Adapters expose `lifecycleState`; pre-connect capabilities are disabled and
  pre-connect health is unavailable.
- Approval resolution returns `RuntimeApprovalResolution`, not `void`.
- Use `PERMISSION_DENIED` and `PROVIDER_UNAVAILABLE`; duplicate pre-alpha names
  `AUTHORIZATION_FAILED` and `RUNTIME_UNAVAILABLE` are removed.
- Network-policy rejection uses `NETWORK_POLICY_REJECTED`.
- Core test ports move to `/testing`, low-level helpers to `/experimental`, and
  sanitizer utilities to `/diagnostics`.
- OpenClaw codecs/frames and Hermes parser/schema helpers move to each adapter's
  `/experimental` entrypoint.
- Unsupported deep imports are blocked by export maps.

All public packages are ESM-only. Node-specific execution requires Node.js
`>=22.13`. Experimental entrypoints may change during the alpha series.
