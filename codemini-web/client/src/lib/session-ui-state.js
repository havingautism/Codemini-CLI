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

function compactSidebarTitle(text = "") {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "新会话";
  return cleaned.length > 48 ? `${cleaned.slice(0, 45).trimEnd()}...` : cleaned;
}

/** Build the first sidebar entry once a conversation actually starts. */
export function buildConversationStartSidebarEntry({
  sessionId,
  text = "",
  isGeneral = false,
  projectDir = null,
  projectKey = null,
  updatedAt = new Date().toISOString(),
} = {}) {
  const id = String(sessionId || "").trim();
  if (!id) return null;
  const entry = {
    id,
    title: compactSidebarTitle(text),
    preview: compactSidebarTitle(text),
    messageCount: 1,
    isGeneral: Boolean(isGeneral),
    updatedAt,
  };
  if (!entry.isGeneral) {
    const dir = projectDir || projectKey || null;
    if (dir) {
      entry.projectDir = dir;
      entry.projectKey = projectKey || dir;
    }
  }
  return entry;
}

/** Insert or refresh a sidebar session so started chats appear immediately. */
export function upsertSidebarSession(sessions = [], entry = {}) {
  const id = String(entry?.id || "").trim();
  if (!id) return Array.isArray(sessions) ? [...sessions] : [];

  const list = Array.isArray(sessions) ? sessions : [];
  const existingIndex = list.findIndex((session) => session?.id === id);
  if (existingIndex === -1) {
    return [
      {
        title: "新会话",
        messageCount: 0,
        ...entry,
        id,
      },
      ...list,
    ];
  }

  // Later turns may patch metadata only — never clobber an existing title
  // with upsert defaults.
  const merged = { ...list[existingIndex], ...entry, id };
  return [merged, ...list.filter((_, index) => index !== existingIndex)];
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
