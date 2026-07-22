function compactMeta(compact) {
  if (!compact) return null;
  return {
    boundaryIndex: compact.boundaryIndex,
    mode: compact.mode,
    timestamp: compact.timestamp,
  };
}

export async function loadSessionForSwitch({
  sessionId,
  pool,
  ensureSession,
  loadStoredSession,
  loadStoredUiMessages,
  serializeMessages = (messages) => messages,
  normalizeProjectPath = (value) => value,
  isGeneralProjectDir = () => false,
  setDefaultProjectDir = null,
}) {
  const liveEntry = pool.entries.get(sessionId);
  if (liveEntry?.bridge) {
    const projectDir = pool.getSessionState(sessionId)?.projectDir || liveEntry.projectDir;
    const resolvedProjectDir = normalizeProjectPath(projectDir) || projectDir;
    if (resolvedProjectDir) setDefaultProjectDir?.(resolvedProjectDir);
    return {
      ok: true,
      sessionId,
      cwd: resolvedProjectDir,
      state: {
        ...liveEntry.bridge.getState(),
        cwd: resolvedProjectDir,
        isGeneral: isGeneralProjectDir(resolvedProjectDir),
        runtimePending: false,
      },
      sessionData: {
        messages: liveEntry.bridge.getSessionMessages(),
        compact: liveEntry.bridge.getSessionCompactMeta(),
        uiMessages: await liveEntry.bridge.getUiMessages(sessionId),
      },
    };
  }

  const session = await loadStoredSession(sessionId);
  const projectDir = normalizeProjectPath(session.projectDir) || session.projectDir;
  if (projectDir) setDefaultProjectDir?.(projectDir);

  // History is storage-backed and can be shown immediately. Runtime creation may
  // scan/index the project and run startup hooks, so warm it without blocking UI.
  Promise.resolve()
    .then(() => ensureSession(sessionId))
    .catch(() => {});

  return {
    ok: true,
    sessionId,
    cwd: projectDir,
    state: {
      sessionId,
      status: 'idle',
      busy: false,
      requestInFlight: false,
      model: session.model || '',
      cwd: projectDir,
      isGeneral: isGeneralProjectDir(projectDir),
      runtimePending: true,
    },
    sessionData: {
      messages: serializeMessages(session.messages || []),
      compact: compactMeta(session.compact),
      uiMessages: (await loadStoredUiMessages(sessionId)) || [],
    },
  };
}
