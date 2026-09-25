export function getDecisionProviderStatus({ provider, baseUrl, hasApiKey = false } = {}) {
  if (provider === 'rules') return { ready: true, reason: '' };
  if (provider !== 'jev' && provider !== 'laya') return { ready: false, reason: 'select_provider' };

  const url = String(baseUrl || '').trim();
  if (!url) return { ready: false, reason: 'missing_url' };
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return { ready: false, reason: 'invalid_url' };
  } catch {
    return { ready: false, reason: 'invalid_url' };
  }
  if (provider === 'jev' && !hasApiKey) return { ready: false, reason: 'missing_key' };
  return { ready: true, reason: '' };
}
