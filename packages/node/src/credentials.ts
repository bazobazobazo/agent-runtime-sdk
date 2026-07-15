import { RuntimeError, type RuntimeAuthInput } from '@banzae/agent-runtime-core';
import type { RuntimeCredentialProvider } from '@banzae/agent-runtime-detection';

/** Public alpha contract for environment credential provider options. */
export type EnvironmentCredentialProviderOptions = {
  environment?: Readonly<Record<string, string | undefined>>;
  defaultKind?: 'bearer' | 'token';
};

/** Resolves `env:VARIABLE_NAME` references without putting credentials in CLI arguments. */
export class EnvironmentRuntimeCredentialProvider implements RuntimeCredentialProvider {
  private readonly environment: Readonly<Record<string, string | undefined>>;
  private readonly defaultKind: 'bearer' | 'token';

  constructor(options: EnvironmentCredentialProviderOptions = {}) {
    this.environment = options.environment ?? process.env;
    this.defaultKind = options.defaultKind ?? 'bearer';
  }

  async resolve(reference: string): Promise<RuntimeAuthInput> {
    if (!reference.startsWith('env:')) {
      throw new RuntimeError({
        code: 'INVALID_CONFIGURATION',
        retryable: false,
        message: 'Environment credential references must use the env: prefix',
        operation: 'credentials.resolve',
      });
    }
    const name = reference.slice(4);
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(name)) {
      throw new RuntimeError({
        code: 'INVALID_CONFIGURATION',
        retryable: false,
        message: 'Environment credential reference is invalid',
        operation: 'credentials.resolve',
      });
    }
    const token = this.environment[name];
    if (!token) {
      throw new RuntimeError({
        code: 'AUTHENTICATION_REQUIRED',
        retryable: false,
        message: 'Credential reference could not be resolved',
        operation: 'credentials.resolve',
      });
    }
    return this.defaultKind === 'bearer' ? { kind: 'bearer', token } : { kind: 'token', token };
  }
}
