import { RuntimeError } from '@banzae/agent-runtime-core';
import type { OpenClawProtocolCodec } from './types.js';

export class OpenClawProtocolRegistry {
  private readonly codecs = new Map<number, OpenClawProtocolCodec>();

  register(codec: OpenClawProtocolCodec): void {
    if (this.codecs.has(codec.protocolVersion)) {
      throw new Error(`Duplicate OpenClaw protocol v${codec.protocolVersion}`);
    }
    this.codecs.set(codec.protocolVersion, codec);
  }

  preferredVersions(): number[] {
    return [...this.codecs.keys()].sort((a, b) => b - a);
  }

  require(version: number): OpenClawProtocolCodec {
    const codec = this.codecs.get(version);
    if (!codec) {
      throw new RuntimeError({
        code: 'PROTOCOL_MISMATCH',
        retryable: false,
        adapterId: 'openclaw',
        message: `OpenClaw protocol v${version} is not supported`,
        details: { supportedVersions: this.preferredVersions(), requiredVersion: version },
      });
    }
    return codec;
  }
}
