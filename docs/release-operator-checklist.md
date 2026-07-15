# v0.1.0-alpha.1 operator prerequisites

Status: publication blocked pending operator verification and approval.

| Prerequisite | Status | Evidence / required action |
|---|---|---|
| GitHub main branch protection | unverified | API access was insufficient; an administrator must verify PR-only changes, required checks, conversation resolution, and force-push/deletion prevention. |
| Required CI, CodeQL, dependency review | unverified | Workflows exist and pass, but an administrator must verify they are required by branch protection. |
| Release-tag protection | not configured | No repository ruleset was visible; protect `v*` creation and updates before tagging. |
| `npm-release` environment | not configured | Create it with a required reviewer, prevent self-review, disable administrator bypass, and permit deployment only from protected release tags. |
| Workflow modification ownership | verified | CODEOWNERS covers workflows, manifests, release/security scripts, configuration, and API reports. |
| `@banzae` npm scope ownership | operator action required | Confirm scope ownership and public scoped-package publication authority. |
| Six npm package names available | operator action required | Verify all six exact public names remain available before approving the bootstrap. |
| npm account/organization 2FA policy | operator action required | Require the reviewed account and organization 2FA policy for publication operators. |
| Temporary bootstrap procedure | operator action required | Independently approve the exact tag, six tarballs, short-lived granular scope-restricted token, `next` tag, provenance, and immediate revocation procedure. |
| npm trusted publishers after bootstrap | operator action required | Configure all six packages for `bazobazobazo/agent-runtime-sdk`, workflow `release.yml`, environment `npm-release`, action `npm publish`; then verify OIDC and disallow traditional tokens. |
| npm provenance | verified in repository | Package metadata and workflow request provenance; verify npm-side acceptance during approved publication. |
| Bootstrap secret/token cleanup | operator action required | Immediately revoke the token, remove the temporary environment secret, and verify no long-lived npm write token remains. |

Do not create a tag, dispatch publication, or approve a release while any
required external setting is unverified or not configured.
