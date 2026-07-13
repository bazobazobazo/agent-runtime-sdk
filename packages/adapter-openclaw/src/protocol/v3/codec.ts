import { BaseOpenClawCodec } from '../shared.js';

export class OpenClawV3Codec extends BaseOpenClawCodec {
  readonly protocolVersion = 3;
  readonly protocolName = 'openclaw-gateway-v3' as const;
}

export function openClawV3Codec(): OpenClawV3Codec {
  return new OpenClawV3Codec();
}
