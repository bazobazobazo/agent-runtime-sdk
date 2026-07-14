/**
 * Experimental protocol-authoring API. Raw OpenClaw wire contracts may change
 * during the 0.x series and are not application-level SDK contracts.
 */
export { OpenClawProtocolRegistry, OPENCLAW_SUPPORTED_PROTOCOLS } from './protocol/registry.js';
export { openClawV3Codec, OpenClawV3Codec } from './protocol/v3/codec.js';
export { openClawV4Codec, OpenClawV4Codec } from './protocol/v4/codec.js';
export type {
  OpenClawProtocolCodec,
  OpenClawFrame,
  OpenClawChallenge,
  OpenClawHello,
  OpenClawProtocolFixtureMetadata,
} from './protocol/types.js';
