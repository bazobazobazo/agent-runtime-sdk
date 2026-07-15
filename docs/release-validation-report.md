# v0.1.0-alpha.1 release validation

Status: release candidate ready for pull-request review; publication remains blocked.

## Version and API

- Six public packages: synchronized at `0.1.0-alpha.1` with exact compatible internal ranges.
- Codex, Pi, and adapter template: private `0.0.0`, excluded from plans and artifacts.
- Initial Changeset: consumed; six package changelogs and deterministic lockfile generated.
- Public API: 11 deterministic reports, 250 classified exports, no additions or removals.

## Test results

- Repository: 229 tests in 15 files passed.
- Examples: strict typecheck and one deterministic example test passed.
- Bounded fuzz: seed `20260714`, 10 properties at 100 runs, zero failures.
- Extended fuzz: seed `20260714`, 10 properties at 5,000 runs (50,000 generated cases), zero failures and no shrunk counterexamples. Final suite duration was 7.68 seconds. The separately measured run used 8.93 seconds wall time and 268,428 KiB peak RSS.
- Resilience: 9 tests passed. The measured run used 3.42 seconds wall time and 229,360 KiB peak RSS.
- Stress coverage includes 10,000 sequential OpenClaw RPCs, 1,000 reverse-order concurrent responses, 1,000 aborts, 10,000 bounded dedupe operations, 10,000 mapped events, 1,000 sanitized reports, and 1,000 detection cycles. Resource counters returned to zero where exposed.
- Full adapter tests cover concurrent isolation, active-stream close behavior, payload limits, bounded deduplication, and rejection containment without unhandled rejections.

## Packages and artifacts

| Package | Archive bytes | Files |
|---|---:|---:|
| `@banzae/agent-runtime-core` | 26,806 | 77 |
| `@banzae/agent-runtime-detection` | 24,076 | 33 |
| `@banzae/agent-runtime-openclaw` | 36,051 | 69 |
| `@banzae/agent-runtime-hermes` | 39,416 | 45 |
| `@banzae/agent-runtime-testing` | 40,398 | 33 |
| `@banzae/agent-runtime-node` | 10,199 | 25 |

All archives passed content/size budgets, exact-version checks, workspace-range
resolution, secret/path scanning, and SHA-256 verification. A clean external
consumer installed only the tarballs, compiled strict TypeScript, executed ESM
and fake OpenClaw/Hermes/detector flows, and rejected prohibited deep imports.

Two isolated builds produced identical archive checksums, declaration output,
API reports, SPDX SBOM, package metadata, dependency inventories, and release
manifests under the documented normalization rules.

## Security and compatibility

- Dependency audit: no known high-severity production vulnerabilities.
- Runtime licenses: one external production dependency, compatible.
- Strict Unicode: all 299 existing tracked/untracked text files passed.
- Secret, fixture, artifact, workflow-permission, provenance-preparation, and SBOM validation passed.
- No dedicated OpenClaw or Hermes endpoint, credential reference, or mutation gate was configured. No runtime was contacted, no live report was generated, and compatibility evidence was not upgraded.
- OpenClaw v3/v4 remain fixture and fake-server conformance validated. Hermes complete live validation remains pending.

## Release controls

The manual workflow is tag-bound, requires explicit publication confirmation
and the protected `npm-release` environment, and grants OIDC only to its
publication job. Repository code expects no long-lived npm token. External
GitHub/npm prerequisites in `release-operator-checklist.md` remain blocking
until operators verify or configure them.

No package was published. No npm dist-tag, Git tag, GitHub release, or customer
runtime action was created or invoked.
