export const ACTIVE_SESSION_STATUSES = new Set([
  "queued",
  "running",
  "waiting",
  "waiting_approval",
  "waiting_input",
]);

export function activeSessionIds(runtimeById = {}) {
  return Object.entries(runtimeById)
    .filter(([, runtime]) => ACTIVE_SESSION_STATUSES.has(runtime?.status))
    .map(([sessionId]) => sessionId);
}

export function interactiveRequestForSession(state, kind) {
  const runtime = state.sessionRuntimeById?.[state.currentSessionId];
  return kind === "approval"
    ? runtime?.pendingApproval || null
    : runtime?.pendingUserInput || null;
}

export function projectSessionRuntime(sessions = [], runtimeById = {}) {
  return sessions.map((session) => {
    const runtime = runtimeById[session.id] || {};
    const runtimeStatus = runtime.status || "idle";
    return {
      ...session,
      runtimeStatus,
      queuePosition: runtime.queuePosition,
      needsAttention:
        runtime.needsAttention === true ||
        Boolean(runtime.pendingApproval || runtime.pendingUserInput),
      parallelWriteRisk: runtime.parallelWriteRisk === true,
    };
  });
}

export async function abortSessionIds(
  sessionIds,
  abortRequest,
  { allowPartial = false } = {},
) {
  if (!allowPartial) {
    for (const sessionId of sessionIds) await abortRequest(sessionId);
    return { succeeded: [...sessionIds], failed: [] };
  }

  const settled = await Promise.allSettled(
    sessionIds.map((sessionId) => abortRequest(sessionId)),
  );
  const succeeded = [];
  const failed = [];
  settled.forEach((result, index) => {
    const sessionId = sessionIds[index];
    if (result.status === "fulfilled") succeeded.push(sessionId);
    else failed.push({ sessionId, reason: result.reason });
  });
  return { succeeded, failed };
}
