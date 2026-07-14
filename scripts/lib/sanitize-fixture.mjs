export const SANITIZER_VERSION = 'openclaw-sanitizer-v2';

const SECRET_KEY_RE =
  /^(authorization|token|accessToken|refreshToken|gatewayToken|deviceToken|password|secret|signature|cookie|privateKey|private_key|apiKey)$/i;
const SECRET_SUBSTRING_RE = /(authorization|token|secret|password|cookie|private.?key|signature|api.?key|credential)/i;
const ENVIRONMENT_KEY_RE = /^(snapshot|presence|health|sessions|path|host|ip|deviceId|instanceId|text)$/i;
const HOST_RE = /\b([a-z0-9-]+\.)*banzae\.dev\b/gi;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const HOME_PATH_RE = /\/home\/[^\s"',)]+/g;

export function sanitizeFixture(value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    return value
      .replace(HOST_RE, 'runtime.example.test')
      .replace(IPV4_RE, '192.0.2.1')
      .replace(HOME_PATH_RE, '/home/runtime');
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeFixture(item));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        SECRET_KEY_RE.test(key) || SECRET_SUBSTRING_RE.test(key) || ENVIRONMENT_KEY_RE.test(key)
          ? '__REDACTED__'
          : sanitizeFixture(nested),
      ]),
    );
  }
  return String(value);
}

export function sanitizeFrameText(text) {
  try {
    return JSON.stringify(sanitizeFixture(JSON.parse(text)));
  } catch {
    return String(text)
      .replace(HOST_RE, 'runtime.example.test')
      .replace(IPV4_RE, '192.0.2.1')
      .replace(HOME_PATH_RE, '/home/runtime');
  }
}
