/**
 * Resolve which project directory git status/diff APIs should use.
 * Prefer the active session's projectDir so refresh/session-switch stay correct
 * even when the server-global currentProjectDir is stale (e.g. general workspace).
 */
export function resolveGitCwd({ sessionId, getSessionProjectDir, fallbackDir } = {}) {
  const id = String(sessionId || '').trim();
  if (id && typeof getSessionProjectDir === 'function') {
    const fromSession = String(getSessionProjectDir(id) || '').trim();
    if (fromSession) return fromSession;
  }
  return String(fallbackDir || '').trim();
}
