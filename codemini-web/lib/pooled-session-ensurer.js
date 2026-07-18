export function createPooledSessionEnsurer({
  pool,
  loadSession,
  resolveProjectDir,
  prepareSession = async (session) => session,
  onCreated = async () => {},
  model,
} = {}) {
  if (!pool?.entries || typeof pool.ensureSession !== 'function') {
    throw new TypeError('pool must expose entries and ensureSession');
  }
  if (typeof loadSession !== 'function') throw new TypeError('loadSession must be a function');
  if (typeof resolveProjectDir !== 'function') throw new TypeError('resolveProjectDir must be a function');

  const pending = new Map();
  return async (sessionId) => {
    const existing = pool.entries.get(sessionId);
    if (existing) return existing;
    if (pending.has(sessionId)) return pending.get(sessionId);

    const request = (async () => {
      const loaded = await loadSession(sessionId);
      const projectDir = await resolveProjectDir(loaded);
      const session = await prepareSession(loaded, projectDir);
      const entry = await pool.ensureSession({ sessionId, projectDir, model });
      await onCreated(entry, session);
      return entry;
    })().finally(() => pending.delete(sessionId));
    pending.set(sessionId, request);
    return request;
  };
}
