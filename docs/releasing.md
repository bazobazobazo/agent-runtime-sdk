# Release engineering

Status: preparation workflow for `0.1.0-alpha.1`. Nothing in this document means
that a package, tag, provenance statement, or GitHub release already exists.

## Release architecture

The six public packages release together under one fixed SDK version:

- `@banzae/agent-runtime-core`
- `@banzae/agent-runtime-detection`
- `@banzae/agent-runtime-openclaw`
- `@banzae/agent-runtime-hermes`
- `@banzae/agent-runtime-testing`
- `@banzae/agent-runtime-node`

Codex, Pi, and the adapter template are private and excluded. Runtime product,
OpenClaw wire protocol, and Hermes protocol/runtime versions remain independent
from the SDK package version. Alpha `0.x` changes may break API compatibility;
breaking changes require migration notes. No stable API promise exists before 1.0.

The release-candidate PR applies the exact reviewed version to all six tracked
manifests, consumes the pending Changeset, and uses exact synchronized workspace
ranges. Packed metadata resolves those ranges to the concrete candidate version,
preventing incompatible package resolution.

## Local preparation

Run `pnpm release:plan` to review the six-package plan and `pnpm
release:dry-run` to build ignored artifacts under `artifacts/release/`. The dry
run clears stale staging, builds, extracts/checks API reports, packs all six
packages, installs them into an external clean consumer, executes fake flows,
generates SPDX/checksums/manifest/release-note preview, verifies product
independence across sources and tarballs, and scans the result.

`pnpm release:gate` adds repository tests, bounded fuzzing, resilience,
documentation/examples, dependency/license/security checks, and two-build
reproducibility. It must leave tracked/untracked repository state unchanged and
never contact a runtime, publish, tag, or create a release.

The candidate channel is `next`. `release.config.json`, the release plan, dry-run
output, release manifest, release-note preview, and publication workflow must all
agree on that dist-tag. An alpha must never update `latest`. The stable mapping
to `latest` exists as a separate explicit policy and requires its own reviewed
stable release change.

## One-time publication bootstrap

Package-level trusted publishing cannot bootstrap a package that does not yet
exist in npm because its trusted-publisher settings page is not available. The
first approved publication of these six new names therefore requires a one-time
bootstrap. This procedure is documentation only; do not commit, request in a PR,
or execute with a token during release-candidate preparation.

1. Verify ownership of the `@banzae` scope and availability of all six reviewed
   package names.
2. After independent approval of the exact `v0.1.0-alpha.1` tag and six staged
   tarballs, create a short-lived granular npm token restricted to the `@banzae`
   scope and publication permission.
3. Make the token available only to the protected `npm-release` environment for
   the approved bootstrap run. Never print it or write it to repository files.
4. Publish each reviewed tarball with `npm publish <tarball> --access public
   --tag next --provenance`. Stop and inventory results if publication is partial.
5. Immediately revoke the granular token after successful publication (or after
   any aborted/failed attempt) and remove the temporary environment secret.

Do not publish an alpha without `--tag next`; doing so would move `latest`.

## Required post-bootstrap trusted publishing

After the initial package records exist, configure trusted publishing separately
in the settings for each of the six packages using exactly:

- GitHub user: `bazobazobazo`
- Repository: `agent-runtime-sdk`
- Workflow filename: `release.yml`
- Environment: `npm-release`
- Allowed action: `npm publish`

Confirm one approved OIDC publication path works, then require 2FA and disallow
traditional token publication for each package. Remove any temporary bootstrap
secret, confirm the granular token is revoked, and verify that no long-lived npm
write token remains. OIDC trusted publishing is the required path after
bootstrap; forks and pull requests must never be authorized publishers.

The publication job pins Node.js `22.14.0`, installs npm `11.5.1`, and checks
both minimums before it can publish. It runs only on a GitHub-hosted runner and
must not rely on the npm CLI bundled with Node.

The workflow is `workflow_dispatch` only. Its preparation job has read-only
permissions. The publication job requires `confirm_publish: true`, an exact
allowed `v<version>` tag, repository identity, successful preparation, protected
environment approval, and the narrowly scoped `id-token: write` permission.

## Final release-candidate sequence

1. Review the exact target versions and consumed Changeset in the release PR.
2. Run extended 5,000-case fuzzing plus the full release gate.
3. Review tarball budgets, SBOM, checksums, manifest, compatibility report,
   migrations, and release-note preview.
4. Create/approve the release tag only with explicit human authorization.
5. For the first release only, complete the approved bootstrap procedure above;
   for later releases, dispatch the manual OIDC workflow on that tag with
   publication confirmation.
6. Verify all six npm records and provenance statements before preparing a draft
   GitHub release.
7. Attach checksums, SBOM, compatibility report, artifact manifest, migrations,
   known limitations, and changelog. Draft first where practical.

## Stop, rollback, and incident checklist

- Cancel a running workflow before the publication job starts when evidence is incomplete.
- If publication is partial, stop; inventory successful packages/versions and do
  not blindly retry the full set.
- Prefer npm deprecation plus a corrected alpha over unpublish; unpublish only
  within npm policy and after security/legal review.
- Never overwrite a published version. Issue a new alpha with an explicit fix.
- Rotate compromised credentials at their authority and invalidate affected
  candidates; repository code must never contain the replacement secret.
- Mark a candidate invalid when checksums, provenance, compatibility evidence,
  package contents, or version relationships are wrong.
- If a runtime regression is discovered, downgrade the compatibility claim,
  record evidence, and issue corrected notes/package only after review.
- If an accidental public export ships, document it, assess consumers/security,
  and use a migration plus corrected prerelease rather than silent removal.
- Coordinate security communications through the private reporting process in
  `SECURITY.md`; do not expose exploit details before mitigation.

## Recommended repository protection

These settings are recommendations and are not claimed as applied:

- require pull requests, resolved conversations, CI, CodeQL, and dependency
  review (or the frozen-lockfile audit fallback) on `main`;
- block force pushes and deletion of `main`;
- protect `v*` release tags and restrict tag creation;
- require protected-environment approval for `npm-release`;
- require CODEOWNERS review for workflows, package manifests, release/security
  scripts, configuration, and API reports.

## After publication

After publication, the alpha packages will be installable as
`@banzae/agent-runtime-core@0.1.0-alpha.1` and matching versions of the other
five packages. Do not use that command as proof that publication occurred.
