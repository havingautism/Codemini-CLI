import { setTimeout as delay } from 'node:timers/promises';
import tls from 'node:tls';
import { Agent, Dispatcher1Wrapper } from 'undici';

// Windows applications can trust local TLS inspection roots that Node's bundled CAs omit.
// Keep Node's existing roots and add the Windows trust store without disabling verification.
if (process.platform === 'win32'
  && typeof tls.getCACertificates === 'function'
  && typeof tls.setDefaultCACertificates === 'function') {
  const systemCAs = tls.getCACertificates('system');
  if (systemCAs.length) {
    tls.setDefaultCACertificates([...new Set([...tls.getCACertificates('default'), ...systemCAs])]);
  }
}

// 默认使用 HTTP/1.1，避免部分模型网关拒绝 HTTP/2。适配器兼容内置 fetch 的新旧回调接口。
const providerDispatcher = new Dispatcher1Wrapper(new Agent({ allowH2: false }));

export async function fetchWithRetry(url, init, { maxRetries = 2 } = {}) {
  const retries = Number.isFinite(Number(maxRetries)) ? Math.max(0, Math.min(10, Math.floor(Number(maxRetries)))) : 2;
  for (let attempt = 0; ; attempt++) {
    let waitMs = Math.min(30000, 250 * 2 ** attempt);
    try {
      const response = await fetch(url, { ...init, dispatcher: init?.dispatcher || providerDispatcher });
      if (response.ok || ![408, 409, 425, 429].includes(response.status) && response.status < 500 || attempt >= retries) return response;
      const retryAfter = response.headers.get('retry-after');
      if (retryAfter) {
        const seconds = Number(retryAfter);
        const requested = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
        if (Number.isFinite(requested)) waitMs = Math.max(waitMs, requested);
      }
      await response.body?.cancel().catch(() => {});
    } catch (error) {
      if (init?.signal?.aborted || ['AbortError', 'TimeoutError'].includes(error?.name)) throw error;
      if (attempt >= retries || !/fetch failed|network|socket|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(String(error?.message))) {
        const code = error?.cause?.code || error?.cause?.errors?.[0]?.code;
        if (code && /^[A-Z][A-Z0-9_]+$/.test(code)) {
          // Include a useful transport cause without exposing headers, keys or URLs.
          throw Object.assign(new Error(`${error.message} (${code})`, { cause: error }), { name: error.name });
        }
        throw error;
      }
    }
    await delay(Math.min(2147483647, waitMs), undefined, { signal: init?.signal });
  }
}
