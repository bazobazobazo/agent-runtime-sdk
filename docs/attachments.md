# Attachments

Runtime inputs may contain text, image, and file parts. Attachments use bounded
inline bytes with a MIME type, sanitized filename, declared size, optional
SHA-256 hash, and optional opaque consumer reference.

Adapters validate negotiated capabilities, count, size, MIME syntax, declared
size, filename safety, and hashes before provider activity. The SDK never
retrieves arbitrary URLs, reads `file://` resources, or accepts local paths.
Attachment bytes and content are excluded from diagnostics and errors.

The SDK transports attachments. Authorization, malware scanning, durable
storage, ownership, retention, privacy, and billing remain consumer concerns.
