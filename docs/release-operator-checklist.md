# v0.1.0-alpha.1 operator prerequisites

Status: publication blocked pending operator verification and approval.

| Prerequisite | Status | Evidence / required action |
|---|---|---|
| GitHub main branch protection | unverified | API access was insufficient; an administrator must verify PR-only changes, required checks, conversation resolution, and force-push/deletion prevention. |
| Required CI, CodeQL, dependency review | unverified | Workflows exist and pass, but an administrator must verify they are required by branch protection. |
| Release-tag protection | not configured | No repository ruleset was visible; protect `v*` creation and updates before tagging. |
| `npm-release` environment | not configured | GitHub returned no environment; create it with required approvers and restricted deployment branches/tags. |
| Workflow modification ownership | verified | CODEOWNERS covers workflows, manifests, release/security scripts, configuration, and API reports. |
| npm organization/package ownership | operator action required | Confirm ownership and public scoped-package access for all six names. |
| npm trusted publisher | operator action required | Link this repository and `.github/workflows/release.yml` for each package. |
| npm provenance | verified in repository | Package metadata and workflow request provenance; verify npm-side acceptance during approved publication. |
| npm access and 2FA/operator policy | operator action required | Confirm organization access policy and required operator authentication without adding a repository token. |

Do not create a tag, dispatch publication, or approve a release while any
required external setting is unverified or not configured.
