# Attachments

Runtime inputs may contain text, image, and file parts. Attachments use bounded
inline bytes with a MIME type, sanitized filename, declared size, optional
SHA-256 hash, and optional opaque consumer reference.

Adapters validate negotiated capabilities, count, size, MIME syntax, declared
size, filename safety, and hashes before provider activity. A supplied SHA-256
hash must match the bounded byte source. The SDK never
retrieves arbitrary URLs, reads `file://` resources, or accepts local paths.
Attachment bytes and content are excluded from diagnostics and errors.

## OpenClaw transport

OpenClaw Gateway protocols v3 and v4 carry attachments inline in the same
JSON `chat.send` request as base64 content. There is no separate upload,
registration, temporary blob, multipart HTTP, or WebSocket binary-frame step.
Consequently, attachment validation completes before the single run request,
and an attachment cannot be partially accepted independently from that run.

- Protocol v3 accepts image attachments. Generic files are rejected by the
  adapter before `chat.send` because the observed v3 gateway drops non-images.
- Protocol v4 accepts images and files. It uses the `fileName` wire field and
  may stage non-image bytes into runtime-managed media before dispatch.

OpenClaw hello responses can omit attachment flags. The adapter therefore uses
the negotiated protocol codec plus `chat.send` method availability as its
attachment transport evidence. An explicit but incorrect manifest flag does
not override a validated protocol codec. Unknown protocol versions still fail
closed.

History normalization retains only safe attachment metadata such as kind and
MIME type. Inline bytes and runtime-local media paths are not returned.

The SDK transports attachments. Authorization, malware scanning, durable
storage, ownership, retention, privacy, and billing remain consumer concerns.
