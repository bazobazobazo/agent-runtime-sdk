# Security

Runtime credentials should be treated as privileged execution authority.

The SDK:

- resolves secrets through `RuntimeSecretStore`;
- keeps tokens and private keys out of logs and normal state;
- redacts error details by default;
- rejects unsupported inputs before provider execution;
- provides endpoint normalization helpers.

Applications must enforce endpoint allowlists, SSRF policy, tenant isolation,
approval authorization, file authorization, and audit retention.
