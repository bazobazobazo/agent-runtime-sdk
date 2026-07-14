import { BaseOpenClawCodec } from '../shared.js';
import { openClawV4Mappings } from './mappings.js';

export class OpenClawV4Codec extends BaseOpenClawCodec {
  readonly protocolVersion = 4;
  readonly protocolName = 'openclaw-gateway-v4' as const;
  protected readonly mappings = openClawV4Mappings;
}

export function openClawV4Codec(): OpenClawV4Codec {
  return new OpenClawV4Codec();
}
