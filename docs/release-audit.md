# Phase 6 release audit

Status: internal engineering checklist for the `0.1.0-alpha.1` candidate.

- [x] Six public packages identified; all source manifests are synchronized at `0.1.0`.
- [x] Codex, Pi, and adapter template are private and have no exports/publish config.
- [x] Package graph verified: core is the common contract; detection uses core/OpenClaw;
  adapters/testing use core; Node composes core, detection, both adapters, and `ws`.
- [x] ESM-only Node `>=22.13` build uses TypeScript project references and explicit export maps.
- [x] Existing API extraction, package boundary/content, consumer, security, SBOM,
  and dry-run scripts inspected from source rather than documentation.
- [x] Missing metadata, Changesets config, archive budgets, release artifacts,
  reproducibility, release workflow, changelog, and CODEOWNERS addressed in Phase 6.
- [x] Fixed synchronized initial-alpha policy selected; final target version remains
  staged rather than applied to tracked manifests in this phase.
- [x] Ordinary CI contains no publication step; manual publication requires tag,
  confirmation, protected environment approval, and OIDC.

Accepted dependency risk: none. `ws` is the only non-development runtime
dependency and remains constrained by the reviewed lockfile and audit.
