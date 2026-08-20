import { normalizeProjectDirKey } from "../../../shared/project-key.js";

export function uniqueNormalizedProjectDirs(items = []) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const key = normalizeProjectDirKey(item);
    if (!key || key === "unknown" || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function activateProjectInList(activeProjectDirs = [], projectDir = "") {
  const key = normalizeProjectDirKey(projectDir);
  const current = uniqueNormalizedProjectDirs(activeProjectDirs);
  if (!key) return current;
  return [key, ...current.filter((item) => item !== key)];
}

export function filterProjectGroupsByActive(
  entries = [],
  activeProjectDirs = [],
  { ready = true } = {},
) {
  const list = Array.isArray(entries) ? [...entries] : [];
  if (!ready) return list;

  const active = uniqueNormalizedProjectDirs(activeProjectDirs);
  if (!active.length) return [];

  const order = new Map(active.map((key, index) => [key, index]));
  return list
    .filter(([key]) => order.has(normalizeProjectDirKey(key)))
    .sort(
      (left, right) =>
        order.get(normalizeProjectDirKey(left[0])) -
        order.get(normalizeProjectDirKey(right[0])),
    );
}

export function buildVisibleProjectGroups({
  sessions = [],
  activeProjectDirs = [],
  ready = true,
} = {}) {
  const groups = new Map();
  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (session?.isGeneral) continue;
    if (Number(session.messageCount || 0) <= 0) continue;
    const key = normalizeProjectDirKey(
      session.projectKey || session.projectDir,
    );
    if (!key || key === "unknown") continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(session);
  }

  const active = uniqueNormalizedProjectDirs(activeProjectDirs);
  if (!ready) return [...groups.entries()];

  for (const key of active) {
    if (!groups.has(key)) groups.set(key, []);
  }

  return filterProjectGroupsByActive([...groups.entries()], active, {
    ready: true,
  });
}

export const ACTIVE_SESSION_STATUSES = new Set([
  "queued",
  "running",
  "waiting",
  "waiting_approval",
  "waiting_input",
]);

export function sessionRuntimeIsBusy(runtime) {
  if (!runtime) return false;
  if (runtime.busy === true) return true;
  return ACTIVE_SESSION_STATUSES.has(runtime.status);
}

export function rekeyPendingQueue(queueMap, fromId, toId) {
  const previousId = String(fromId || "").trim();
  const nextId = String(toId || "").trim();
  const next = queueMap instanceof Map ? new Map(queueMap) : new Map();
  if (!previousId || !nextId || previousId === nextId) return next;
  const queued = next.get(previousId) || [];
  next.delete(previousId);
  if (queued.length) next.set(nextId, queued);
  else next.delete(nextId);
  return next;
}

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

const SIDEBAR_EMOJI_PREFIX_RE = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3)/u;

export function displaySessionTitle(value = "") {
  const title = String(value || "").replace(/\s+/g, " ").trim();
  if (!title) return "💬";
  return SIDEBAR_EMOJI_PREFIX_RE.test(title) ? title : `💬 ${title}`;
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
    title: displaySessionTitle(compactSidebarTitle(text)),
    preview: compactSidebarTitle(text),
    messageCount: 1,
    isGeneral: Boolean(isGeneral),
    updatedAt,
  };
  if (!entry.isGeneral) {
    const dir = projectDir || projectKey || null;
    if (dir) {
      const key = normalizeProjectDirKey(projectKey || dir) || dir;
      entry.projectDir = dir;
      entry.projectKey = key;
    }
  }
  return entry;
}

function isDefaultSidebarTitle(title) {
  const value = String(title || "").trim();
  return !value || value === "新会话" || value === "New session";
}

/**
 * Merge server session list into the live sidebar without clobbering a newer
 * client title (e.g. async session:title that won the race against fetch).
 */
export function mergeFetchedSessions(
  current = [],
  fetched = [],
  { sessionIdsAtRequestStart = [], requestStartedAt = 0 } = {},
) {
  const currentById = new Map(
    (Array.isArray(current) ? current : [])
      .filter((session) => session?.id)
      .map((session) => [String(session.id), session]),
  );
  const list = Array.isArray(fetched) ? fetched : [];
  const fetchedIds = new Set(
    list.map((session) => String(session?.id || "").trim()).filter(Boolean),
  );
  const idsAtRequestStart = new Set(
    Array.from(sessionIdsAtRequestStart || [], (id) => String(id || "").trim()).filter(Boolean),
  );
  const requestStartedAtMs = Number(requestStartedAt) || 0;
  const addedDuringRequest = (Array.isArray(current) ? current : []).filter((session) => {
    const id = String(session?.id || "").trim();
    if (!id || fetchedIds.has(id)) return false;
    const updatedAt = Date.parse(session?.updatedAt || 0);
    const updatedDuringRequest =
      requestStartedAtMs > 0 && Number.isFinite(updatedAt) && updatedAt >= requestStartedAtMs;
    return !idsAtRequestStart.has(id) || updatedDuringRequest;
  });
  const mergedFetched = list.map((fetchedSession) => {
    const id = String(fetchedSession?.id || "").trim();
    const existing = currentById.get(id);
    if (!existing) return fetchedSession;

    const merged = { ...existing, ...fetchedSession, id };
    const existingTitle = String(existing.title || "").trim();
    const fetchedTitle = String(fetchedSession.title || "").trim();
    if (!existingTitle || existingTitle === fetchedTitle) return merged;

    const existingAt = Date.parse(existing.updatedAt || 0);
    const fetchedAt = Date.parse(fetchedSession.updatedAt || 0);
    const existingIsNewer =
      Number.isFinite(existingAt) &&
      (!Number.isFinite(fetchedAt) || existingAt > fetchedAt);
    const keepExistingTitle =
      !isDefaultSidebarTitle(existingTitle) &&
      (isDefaultSidebarTitle(fetchedTitle) || existingIsNewer);

    if (keepExistingTitle) {
      merged.title = existingTitle;
      if (existing.updatedAt) merged.updatedAt = existing.updatedAt;
    }
    return merged;
  });
  return [...addedDuringRequest, ...mergedFetched];
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

/** Patch an existing sidebar session without changing its list position. */
export function patchSidebarSession(sessions = [], entry = {}) {
  const id = String(entry?.id || "").trim();
  const list = Array.isArray(sessions) ? sessions : [];
  if (!id) return [...list];
  return list.map((session) =>
    session?.id === id ? { ...session, ...entry, id } : session,
  );
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
