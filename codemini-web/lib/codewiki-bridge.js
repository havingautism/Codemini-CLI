/**
 * Pick a RuntimeBridge whose workspace matches the CodeWiki project.
 *
 * Reuses the current bridge when it is already on that project and idle.
 * Otherwise prefers an existing project session that is idle; if none is
 * available, creates a dedicated session so CodeWiki is not blocked by an
 * in-progress chat on the same project.
 */
export async function resolveCodeWikiBridge({
  codeWikiProjectDir,
  currentProjectDir,
  currentBridge,
  ensurePooledSession,
  createSession,
  findPreferredSessionId,
  sameProject,
} = {}) {
  if (typeof ensurePooledSession !== 'function') {
    throw new TypeError('ensurePooledSession must be a function');
  }
  if (typeof createSession !== 'function') {
    throw new TypeError('createSession must be a function');
  }
  if (!currentBridge || typeof currentBridge.isBusy !== 'function') {
    throw new TypeError('currentBridge must expose isBusy()');
  }

  const onSameProject = typeof sameProject === 'function'
    ? sameProject(codeWikiProjectDir, currentProjectDir)
    : String(codeWikiProjectDir || '') === String(currentProjectDir || '');

  if (onSameProject && !currentBridge.isBusy()) {
    return { bridge: currentBridge, source: 'current' };
  }

  if (typeof findPreferredSessionId === 'function') {
    const preferredId = await findPreferredSessionId(codeWikiProjectDir);
    if (preferredId) {
      const entry = await ensurePooledSession(preferredId);
      const preferredBridge = entry?.bridge;
      if (preferredBridge && typeof preferredBridge.isBusy === 'function' && !preferredBridge.isBusy()) {
        return { bridge: preferredBridge, source: 'preferred', sessionId: preferredId };
      }
    }
  }

  const session = await createSession(codeWikiProjectDir);
  const entry = await ensurePooledSession(session.id);
  return { bridge: entry.bridge, source: 'created', sessionId: session.id };
}
