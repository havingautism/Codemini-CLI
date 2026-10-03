// Keep frontend controls and server-side write permissions aligned.
export const WEB_CONFIG_INTEGER_LIMITS = Object.freeze({
  'execution.max_steps': Object.freeze({ min: 1, max: 1000 }),
  'execution.incomplete_retries': Object.freeze({ min: 0, max: 10 }),
  'harness.distillation.max_candidates': Object.freeze({ min: 1, max: 16 }),
});

export function isWebConfigReadOnly(key) {
  return /^(policy|sandbox|execution|shell|webui)(\.|$)/.test(key)
    && !Object.hasOwn(WEB_CONFIG_INTEGER_LIMITS, key);
}

export function validateWebConfigValue(key, value) {
  if (key === 'harness.distillation.confidence_threshold') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.5 || value > 1) {
      throw new Error(`${key} must be a number between 0.5 and 1`);
    }
    return;
  }
  if (!Object.hasOwn(WEB_CONFIG_INTEGER_LIMITS, key)) return;
  const { min, max } = WEB_CONFIG_INTEGER_LIMITS[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}`);
  }
}
