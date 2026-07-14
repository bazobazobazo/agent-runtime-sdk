# @banzae/agent-runtime-openclaw

OpenClaw Gateway adapter for the Banzae Agent Runtime SDK.

The adapter supports explicit gateway protocol codecs and fails closed on
unknown protocol versions. See the root compatibility matrix for validated
runtime versions and fixtures.

Normal applications use only the root adapter and factory exports. The
`/experimental` entrypoint exposes version codecs and selected wire types for
adapter authors and may change during the alpha series. Raw frames are not the
normal application API.
