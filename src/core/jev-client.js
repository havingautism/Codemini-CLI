const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

export async function askJev({
  endpoint = JEV_ENDPOINT,
  apiKey,
  model = 'jev-latest',
  state,
  questions,
  signal,
  timeoutMs = 8000,
  fetchImpl = globalThis.fetch,
} = {}) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('Jev API key is missing');
  if (typeof fetchImpl !== 'function') throw new Error('Jev fetch is unavailable');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener?.('abort', onAbort, { once: true });
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: String(model || 'jev-latest').trim() || 'jev-latest',
        state,
        questions,
      }),
      signal: controller.signal,
    });
    if (!response?.ok) {
      const detail = typeof response?.text === 'function'
        ? String(await response.text().catch(() => '')).slice(0, 180)
        : '';
      throw new Error(`Jev request failed (${response?.status || 'unknown'})${detail ? `: ${detail}` : ''}`);
    }
    const payload = typeof response.json === 'function' ? await response.json() : null;
    if (!payload || typeof payload !== 'object') throw new Error('Jev response was empty');
    return payload;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}
