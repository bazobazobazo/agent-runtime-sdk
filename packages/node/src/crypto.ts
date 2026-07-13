import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import type { RuntimeCrypto } from '@banzae/agent-runtime-core';

export const nodeCrypto: RuntimeCrypto = {
  randomBytes(size) {
    return new Uint8Array(randomBytes(size));
  },
  async sha256(input) {
    return new Uint8Array(createHash('sha256').update(input).digest());
  },
  async generateEd25519KeyPair() {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    return {
      publicKey: new Uint8Array(publicKey.export({ type: 'spki', format: 'der' })),
      privateKey: new Uint8Array(privateKey.export({ type: 'pkcs8', format: 'der' })),
    };
  },
  async signEd25519(privateKey, message) {
    const key = createPrivateKey({ key: Buffer.from(privateKey), type: 'pkcs8', format: 'der' });
    return new Uint8Array(sign(null, Buffer.from(message), key));
  },
};
