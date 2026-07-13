import { BaseOpenClawCodec } from '../shared.js';

export class OpenClawV4Codec extends BaseOpenClawCodec {
  readonly protocolVersion = 4;
  readonly protocolName = 'openclaw-gateway-v4' as const;
}

export function openClawV4Codec(): OpenClawV4Codec {
  return new OpenClawV4Codec();
}
