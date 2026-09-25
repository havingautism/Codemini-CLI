export function findReusableEmptySession(
  sessions,
  { matchesProject, isBusy, isSessionDisplayEmpty } = {},
) {
  return (
    (Array.isArray(sessions) ? sessions : []).find((session) => {
      if (!session?.id) return false;
      if (Number(session.messageCount || 0) > 0) return false;
      if (typeof matchesProject === "function" && !matchesProject(session)) {
        return false;
      }
      if (typeof isBusy === "function" && isBusy(session.id) === true) {
        return false;
      }
      // An aborted turn can roll core messages back to zero while its Web UI
      // transcript still holds the (settled) request_user_input card. Reusing
      // such a session as "new" surfaces that stale card as residue.
      if (
        typeof isSessionDisplayEmpty === "function" &&
        isSessionDisplayEmpty(session.id) === false
      ) {
        return false;
      }
      return true;
    }) || null
  );
}

export function createEmptySessionAllocator({
  listSessions,
  loadSession,
  createSession,
  projectKeyOf,
  matchesProject,
  isBusy,
  isSessionDisplayEmpty,
} = {}) {
  if (typeof listSessions !== "function") {
    throw new TypeError("listSessions must be a function");
  }
  if (typeof loadSession !== "function") {
    throw new TypeError("loadSession must be a function");
  }
  if (typeof createSession !== "function") {
    throw new TypeError("createSession must be a function");
  }

  const locks = new Map();
  return async function allocateEmptySession(projectDir) {
    const lockKey =
      typeof projectKeyOf === "function"
        ? String(projectKeyOf(projectDir) || projectDir || "")
        : String(projectDir || "");
    const previous = locks.get(lockKey) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const next = previous.then(() => gate, () => gate);
    locks.set(lockKey, next);
    try {
      await previous.catch(() => {});
      const sessions = await listSessions();
      const reusable = findReusableEmptySession(sessions, {
        matchesProject: (session) =>
          typeof matchesProject === "function"
            ? matchesProject(session, projectDir)
            : true,
        isBusy,
        isSessionDisplayEmpty,
      });
      if (reusable?.id) {
        return {
          session: await loadSession(reusable.id),
          reused: true,
        };
      }
      return {
        session: await createSession(projectDir),
        reused: false,
      };
    } finally {
      release();
      if (locks.get(lockKey) === next) locks.delete(lockKey);
    }
  };
}
