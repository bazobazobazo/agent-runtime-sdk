# Security Policy

Report vulnerabilities privately through GitHub's private vulnerability
reporting feature for this repository. If that feature is unavailable, contact
the maintainers through a private channel listed on the repository profile.
Do not open a public issue before maintainers have had a reasonable opportunity
to investigate and coordinate disclosure.

Do not include tokens, prompts, attachment content, private keys, runtime URLs
with embedded credentials, or customer data in issue reports. Provide sanitized
fixtures whenever possible.

Include the affected package/version or commit, impact, reproduction steps,
sanitized evidence, and any relevant runtime/protocol version. Do not test
against systems you do not own or have permission to assess.

Security fixes are prioritized according to impact and exploitability. The
maintainers will acknowledge usable reports and share status when practical,
but this pre-release project does not promise a fixed response or remediation
deadline. Supported security updates currently apply to the latest pre-release
line on `main`; older unreleased snapshots may not receive backports.

Coordinated disclosure is requested. Publish technical details only after a fix
or mitigation is available, or after agreeing on timing with maintainers.

For a package or release incident, follow the stop/deprecate/forward-fix and
credential-rotation checklist in `docs/releasing.md`. Do not silently replace a
published artifact or reuse a published version.
