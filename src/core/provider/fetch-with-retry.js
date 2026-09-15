import { setTimeout as delay } from 'node:timers/promises';

export async function fetchWithRetry(url, init, { maxRetries = 2 } = {}) {
  const retries = Number.isFinite(Number(maxRetries)) ? Math.max(0, Math.min(10, Math.floor(Number(maxRetries)))) : 2;
  for (let attempt = 0; ; attempt++) {
    let waitMs = Math.min(30000, 250 * 2 ** attempt);
    try {
      const response = await fetch(url, init);
      if (response.ok || ![408, 409, 425, 429].includes(response.status) && response.status < 500 || attempt >= retries) return response;
      const retryAfter = response.headers.get('retry-after');
      if (retryAfter) {
        const seconds = Number(retryAfter);
        const requested = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
        if (Number.isFinite(requested)) waitMs = Math.max(waitMs, requested);
      }
      await response.body?.cancel().catch(() => {});
    } catch (error) {
      if (init?.signal?.aborted || ['AbortError', 'TimeoutError'].includes(error?.name) || attempt >= retries || !/fetch failed|network|socket|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(String(error?.message))) throw error;
    }
    await delay(Math.min(2147483647, waitMs), undefined, { signal: init?.signal });
  }
}
