import { RuntimeError } from '@banzae/agent-runtime-core';
import type { OpenClawProtocolCodec } from './types.js';

export const OPENCLAW_SUPPORTED_PROTOCOLS = [
  { protocolName: 'openclaw-gateway-v4', protocolVersion: 4, status: 'supported' },
  { protocolName: 'openclaw-gateway-v3', protocolVersion: 3, status: 'supported' },
] as const;

export class OpenClawProtocolRegistry {
  private readonly codecs = new Map<number, OpenClawProtocolCodec>();

  register(codec: OpenClawProtocolCodec): void {
    if (this.codecs.has(codec.protocolVersion)) {
      throw new Error(`Duplicate OpenClaw protocol v${codec.protocolVersion}`);
    }
    this.codecs.set(codec.protocolVersion, codec);
  }

  supportedVersions(): number[] {
    return [...this.codecs.keys()].sort((a, b) => a - b);
  }

  preferredVersions(): number[] {
    return [...this.codecs.keys()].sort((a, b) => b - a);
  }

  get(version: number): OpenClawProtocolCodec | undefined {
    return this.codecs.get(version);
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
