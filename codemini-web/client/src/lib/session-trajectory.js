const USER_ROLES = new Set(["you", "user"]);
const ASSISTANT_ROLES = new Set(["agent", "assistant"]);
const SKIP_ROLES = new Set(["divider", "system", "plan-overview"]);
const ERROR_STATUSES = new Set(["failed", "error", "blocked", "aborted"]);

function normalizeRole(message) {
  return String(message?.role || "").toLowerCase();
}

function isUserMessage(message) {
  return USER_ROLES.has(normalizeRole(message));
}

function isAssistantMessage(message) {
  return ASSISTANT_ROLES.has(normalizeRole(message));
}

function isAbortDivider(message) {
  if (normalizeRole(message) !== "divider") return false;
  const dividerType = String(message?.dividerType || "").toLowerCase();
  return dividerType === "manual-abort" || dividerType === "abort";
}

function messageText(message) {
  if (typeof message?.text === "string" && message.text) return message.text;
  if (typeof message?.content === "string") return message.content;
  return "";
}

function messageTime(message) {
  return message?.at || message?.timestamp || null;
}

function toMs(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function resolveDurationMs({ startedAt, endedAt, durationMs }) {
  const explicit = Number(durationMs);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  const start = toMs(startedAt);
  const end = toMs(endedAt);
  if (start != null && end != null && end >= start) return end - start;
  return null;
}

function normalizeStatus(status, isStreaming) {
  if (isStreaming) return "running";
  const value = String(status || "").toLowerCase();
  if (value === "running" || value === "pending") return "running";
  if (ERROR_STATUSES.has(value)) return "error";
  return "done";
}

export function stringifyTrajectoryValue(value) {
  if (value == null) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function truncateTrajectoryText(text, max = 240) {
  const value = String(text || "");
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

export function formatTrajectoryDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 1) return "<1s";
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours) return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${seconds}s`;
}

export function formatTrajectoryExportStamp(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function trajectoryExportFilename(sessionId, date = new Date()) {
  const id = String(sessionId || "session").replace(/[^A-Za-z0-9._-]/g, "_");
  return `codemini-trajectory-${id}-${formatTrajectoryExportStamp(date)}.json`;
}

function buildSystemBody(runtimeState) {
  const rs = runtimeState || {};
  const lines = [];
  if (rs.model) lines.push(`model: ${rs.model}`);
  const provider = rs.sdkProvider || rs.provider;
  if (provider) lines.push(`provider: ${provider}`);
  if (rs.mode) lines.push(`mode: ${rs.mode}`);
  return lines.join("\n");
}

function buildContextBody({ runtimeState, projectCwd, isGeneral }) {
  const rs = runtimeState || {};
  const lines = [];
  if (isGeneral) lines.push("chat: general");
  const cwd = rs.cwd || rs.projectDir || projectCwd;
  if (cwd) lines.push(`cwd: ${cwd}`);
  if (rs.approvalMode) lines.push(`approval: ${rs.approvalMode}`);
  if (rs.sandboxMode) lines.push(`sandbox: ${rs.sandboxMode}`);
  return lines.join("\n");
}

function makeEvent(partial) {
  const startedAt = partial.startedAt || null;
  const endedAt = partial.endedAt || null;
  return {
    id: partial.id,
    kind: partial.kind,
    turn: partial.turn,
    title: partial.title || "",
    body: partial.body || "",
    preview: partial.preview || "",
    status: Object.prototype.hasOwnProperty.call(partial, "status")
      ? partial.status
      : null,
    startedAt,
    endedAt,
    durationMs: resolveDurationMs({
      startedAt,
      endedAt,
      durationMs: partial.durationMs,
    }),
  };
}

function hasConversationMessages(messages) {
  return (Array.isArray(messages) ? messages : []).some(
    (message) =>
      isUserMessage(message) ||
      isAssistantMessage(message) ||
      normalizeRole(message) === "error",
  );
}

export function buildTrajectory({
  messages = [],
  runtimeState = null,
  projectCwd = "",
  isGeneral = false,
} = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const events = [];

  if (hasConversationMessages(list)) {
    events.push(
      makeEvent({
        id: "trajectory-system",
        kind: "system",
        turn: 0,
        title: "SYSTEM",
        body: buildSystemBody(runtimeState),
      }),
    );
  }

  let turn = 0;
  let emittedContext = false;

  list.forEach((message, index) => {
    if (isAbortDivider(message)) return;
    const role = normalizeRole(message);
    if (SKIP_ROLES.has(role)) return;

    if (isUserMessage(message)) {
      turn += 1;
      events.push(
        makeEvent({
          id: `trajectory-user-${message.id || index}`,
          kind: "user",
          turn,
          title: "USER",
          body: messageText(message),
          startedAt: messageTime(message),
        }),
      );
      if (!emittedContext) {
        emittedContext = true;
        events.push(
          makeEvent({
            id: "trajectory-context",
            kind: "context",
            turn,
            title: "CONTEXT",
            body: buildContextBody({ runtimeState, projectCwd, isGeneral }),
          }),
        );
      }
      return;
    }

    const activeTurn = Math.max(turn, 1);

    if (role === "error") {
      events.push(
        makeEvent({
          id: `trajectory-error-${message.id || index}`,
          kind: "assistant",
          turn: activeTurn,
          title: "ASSISTANT",
          body: messageText(message),
          status: "error",
          startedAt: messageTime(message),
        }),
      );
      return;
    }

    if (!isAssistantMessage(message)) return;

    const segments = Array.isArray(message.segments) ? message.segments : [];
    segments.forEach((segment, segmentIndex) => {
      if (segment?.type === "thinking") {
        if (!segment.text && !segment.isStreaming) return;
        events.push(
          makeEvent({
            id: `trajectory-thinking-${message.id || index}-${segmentIndex}`,
            kind: "assistant",
            turn: activeTurn,
            title: "thinking",
            body: segment.text || "",
            status: segment.isStreaming ? "running" : "done",
            startedAt: segment.startedAt || messageTime(message),
            endedAt: segment.endedAt || null,
            durationMs: segment.durationMs,
          }),
        );
        return;
      }
      if (segment?.type === "handoff") {
        if (!segment.text && !segment.isStreaming) return;
        events.push(
          makeEvent({
            id: `trajectory-handoff-${message.id || index}-${segmentIndex}`,
            kind: "assistant",
            turn: activeTurn,
            title: "handoff",
            body: segment.text || "",
            status: segment.isStreaming ? "running" : "done",
            startedAt: segment.startedAt || messageTime(message),
            endedAt: segment.endedAt || null,
          }),
        );
        return;
      }
      if (segment?.type === "skill") {
        events.push(
          makeEvent({
            id: `trajectory-skill-${message.id || index}-${segmentIndex}`,
            kind: "skill",
            turn: activeTurn,
            title: segment.name || "skill",
            body: segment.summary || "",
            status: normalizeStatus(segment.status, segment.isStreaming),
            startedAt: segment.startedAt || null,
            endedAt: segment.endedAt || null,
          }),
        );
        return;
      }
      if (segment?.type !== "tools" || !Array.isArray(segment.cards)) return;
      segment.cards.forEach((card, cardIndex) => {
        events.push(
          makeEvent({
            id: `trajectory-tool-${card?.id || `${message.id || index}-${cardIndex}`}`,
            kind: "tool",
            turn: activeTurn,
            title: card?.name || "tool",
            body: stringifyTrajectoryValue(card?.arguments),
            preview:
              typeof card?.summary === "string" && card.summary
                ? card.summary
                : stringifyTrajectoryValue(card?.result),
            status: normalizeStatus(card?.status, card?.isStreaming),
            startedAt: card?.startedAt || null,
            endedAt: card?.endedAt || null,
            durationMs: card?.durationMs,
          }),
        );
      });
    });
  });

  const times = [];
  for (const event of events) {
    const start = toMs(event.startedAt);
    const end = toMs(event.endedAt);
    if (start != null) times.push(start);
    if (end != null) times.push(end);
  }

  return {
    metrics: {
      durationMs: times.length >= 2 ? Math.max(...times) - Math.min(...times) : null,
      turns: events.filter((event) => event.kind === "user").length,
      calls: events.filter((event) => event.kind === "tool").length,
    },
    events,
  };
}

export function filterTrajectoryEvents(
  events,
  { query = "", includeCalls = true } = {},
) {
  const list = Array.isArray(events) ? events : [];
  const needle = String(query || "").trim().toLowerCase();
  return list.filter((event) => {
    if (!includeCalls && (event.kind === "tool" || event.kind === "skill")) {
      return false;
    }
    if (!needle) return true;
    const haystack = [event.kind, event.title, event.body, event.preview]
      .map((part) => String(part || "").toLowerCase())
      .join("\n");
    return haystack.includes(needle);
  });
}
