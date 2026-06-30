export const KIMI_MODEL_PATTERN = /^(kimi|moonshot)/i;

export function isKimiModelName(modelName = '') {
  return KIMI_MODEL_PATTERN.test(String(modelName || '').trim());
}
