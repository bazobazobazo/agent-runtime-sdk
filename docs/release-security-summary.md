# v0.1.0-alpha.1 security summary

The release candidate uses bounded parsing, payload/frame limits, sanitized
errors and diagnostics, injected credential providers, explicit network policy,
strict protocol negotiation, deterministic fuzzing/resilience tests, fixture and
artifact validation, dependency/license checks, secret and hidden-Unicode scans,
and immutable GitHub Action pins.

Publication is manual and tag-bound. Validation runs read-only; the separately
approved `npm-release` job alone receives OIDC permission. No long-lived npm
token is configured. Compatibility reports contain endpoint fingerprints rather
than endpoints and may not contain credentials, raw provider bodies, customer
data, or reusable signatures.

See `security.md`, `security-threat-model.md`, and the root `SECURITY.md` for the
full model and private reporting process.
