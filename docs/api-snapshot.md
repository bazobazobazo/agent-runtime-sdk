# Public API Overview

Status: pre-alpha public API frozen for `v0.1.0-alpha.1`.

The deterministic declaration surface is generated from built `.d.ts` entrypoints:

- machine inventory: `etc/api/public-api-inventory.json`;
- per-entrypoint API reports: `etc/api/*.api.md`;
- contract guide: `docs/public-api.md`;
- migration notes: `docs/migration-public-api-freeze.md`.

Run `pnpm build && pnpm api:extract` to intentionally approve an API change.
Review the generated diff and commit it with the implementation. CI runs
`pnpm api:check` and fails when declarations and reports differ.

## Supported entrypoints

| Package | Entrypoints | Classification |
|---|---|---|
| `@banzae/agent-runtime-core` | `.`, `/diagnostics`, `/experimental`, `/testing` | stable-for-alpha; advanced; experimental; testing-only |
| `@banzae/agent-runtime-detection` | `.` | stable-for-alpha |
| `@banzae/agent-runtime-openclaw` | `.`, `/experimental` | stable-for-alpha; experimental |
| `@banzae/agent-runtime-hermes` | `.`, `/experimental` | stable-for-alpha; experimental |
| `@banzae/agent-runtime-testing` | `.` | testing-only |
| `@banzae/agent-runtime-node` | `.` | stable-for-alpha |

Unsupported deep imports are blocked by package export maps. The SDK is ESM-only
for this alpha and requires Node.js `>=22.13` for Node-specific packages and
tooling.
