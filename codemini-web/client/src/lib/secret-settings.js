// Presence flags are the only secret-related values read from public config.
export function hasConfiguredSecret(config, path) {
  const parts = path.split('.');
  const key = parts.pop();
  const parent = parts.reduce((value, part) => value?.[part], config);
  const flag = key === 'api_key' ? 'hasApiKey' : `has${key.replace(/(^|_)(\w)/g, (_, a, b) => b.toUpperCase())}`;
  return parent?.[flag] === true;
}

// null is an explicit, confirmed removal. Empty input never removes a key.
export function secretSettingWrite(draft) {
  if (draft === null) return '';
  if (typeof draft !== 'string' || !draft.trim()) return undefined;
  return draft.trim();
}
