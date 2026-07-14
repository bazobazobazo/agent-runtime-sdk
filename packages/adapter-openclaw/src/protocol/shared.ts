export { MappedOpenClawCodec as BaseOpenClawCodec, type OpenClawProtocolMappings } from './shared/base-codec.js';
export {
  OPENCLAW_SANITIZER_VERSION,
  asRecord,
  booleanValue,
  numberValue,
  optionalRecord,
  protocolError,
  protocolMismatch,
  sanitizeOpenClawPayload,
  stringArray,
  stringValue,
  validTimestamp,
} from './shared/validation.js';
