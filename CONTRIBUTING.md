# Contributing

The SDK is provider-neutral and pre-alpha. Keep application-domain and
provider-wire concerns behind their documented boundaries.

## Prerequisites

- Node.js `>=22.13`
- pnpm version declared by `packageManager`
- no runtime credentials required for normal development or CI

Install with `pnpm install --frozen-lockfile`. Use one focused branch and commit
per reviewed phase.

## Change requirements

- Public API changes require TSDoc, generated API report updates, a migration
  note, and explicit PR disclosure.
- Protocol changes require sanitized fixtures, success/failure tests, security
  review, and compatibility evidence updates.
- New adapters must pass shared conformance, fuzz/resilience, cleanup, package,
  consumer, and documentation checks before any support claim.
- Do not add real endpoints, credentials, raw provider payloads, or customer data.
- Do not deep-import package `src`, `dist`, codec, parser, transport, or dispatcher internals.

## Validation

Run the focused checks while editing, then `pnpm release:gate`. Documentation
work must also pass `pnpm examples:typecheck`, `pnpm examples:test`, and
`pnpm docs:check`.

Public package changes require a Changeset. Review `pnpm release:plan` and run
`pnpm release:dry-run`; only the final release-candidate phase applies versions.
Publication is restricted to the protected process in `docs/releasing.md`: a
documented one-time bootstrap for brand-new npm package records, followed by the
manually dispatched OIDC workflow for all subsequent publications.

The opt-in live harness is excluded from normal CI and requires explicit target,
credential-reference, and mutation gates. Never publish packages, tag a
release, or change compatibility claims merely because fake tests pass.

## Pull requests

Describe scope, files, public API effects, tests, exact validation, compatibility
claim changes, known limitations, and rollback. Do not self-merge without the
required human review/approval.
