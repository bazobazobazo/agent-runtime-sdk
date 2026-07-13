# Contributing

This SDK is intentionally provider-neutral. Keep product-specific concerns out
of the public packages.

Protocol changes require:

- a compatibility note;
- sanitized fixtures;
- tests for success and failure paths;
- redaction review for logs and errors.

Do not add a new runtime adapter to default detection until it passes the shared
adapter contract suite.
