export function browserOk(tool, data = {}) {
  return { ok: true, tool, ...data };
}

export function browserError(tool, code, error, extra = {}) {
  return {
    ok: false,
    tool,
    code,
    error: String(error || code),
    ...extra,
  };
}

export function formatBrowserResult(result) {
  if (!result || typeof result !== 'object') return String(result ?? '');
  if (result.ok === false) {
    return `Error [${result.code || 'BROWSER_ERROR'}]: ${result.error || 'Browser tool failed.'}`;
  }
  const summary = String(result.summary || '').trim();
  return summary || `${result.tool || 'browser'} ok`;
}
