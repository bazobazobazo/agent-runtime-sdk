# Capability model

`RuntimeCapabilities` is provider-neutral and starts fully disabled.

| Group | Capabilities |
|---|---|
| Sessions | `create`, `resume`, `history`, `fork` |
| Runs | `start`, `status`, `stream`, `cancel`, `approvals` |
| Input | `text`, `images`, `files` |
| Output | `text`, `reasoning`, `tools`, `usage` |
| Health | `liveness`, `readiness` |

Provider-specific capability values must use namespaced `extensions` keys.

## Fail-closed mapping

A capability is true only when provider evidence is explicit, the feature is
implemented by the adapter, and the relevant evidence validates the behavior.
Missing or malformed values remain false. Unsupported operations throw
`UNSUPPORTED_CAPABILITY`; they never silently no-op.

Use `supportsCapability(capabilities, name)` for branching and
`requireCapability(capabilities, name)` when absence should throw.

## Current limits

- OpenClaw and Hermes accept text input through the normalized alpha contract.
- Images/files must be rejected before provider activity when capability false.
- Hermes usage remains false until independently advertised and validated.
- Approval resolution is optional and requires both capability evidence and an
  adapter `resolveApproval` implementation.

Capabilities are observations, not authorization. The host must separately
enforce user, organization, seat, and operation permissions.
