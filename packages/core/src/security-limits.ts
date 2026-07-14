import { RuntimeError } from './errors.js';
import { HARD_RUNTIME_LIMITS, SECURE_RUNTIME_LIMITS, type SecureRuntimeLimitName } from './security-limit-values.js';

export { HARD_RUNTIME_LIMITS, SECURE_RUNTIME_LIMITS, type SecureRuntimeLimitName } from './security-limit-values.js';

export function resolveSecureLimit(
  name: SecureRuntimeLimitName,
  value?: number,
  options: { allowZero?: boolean } = {},
): number {
  const resolved = value ?? SECURE_RUNTIME_LIMITS[name];
  const minimum = options.allowZero || name === 'maxRedirects' ? 0 : 1;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > HARD_RUNTIME_LIMITS[name]) {
    throw new RuntimeError({
      code: 'INVALID_CONFIGURATION',
      retryable: false,
      message: `Runtime security limit ${name} is invalid`,
      details: { name, minimum, maximum: HARD_RUNTIME_LIMITS[name] },
    });
  }
  return resolved;
}
