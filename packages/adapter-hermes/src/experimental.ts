/** Experimental parser and protocol-authoring API; not an application contract. */
export {
  validateHermesCapabilities,
  mapHermesCapabilities,
  isHermesCapabilities,
  type ValidatedHermesCapabilities,
} from './mapping/capabilities.js';
export {
  parseSseStream,
  type SseEvent,
  type SseParserOptions,
} from './sse/parser.js';
