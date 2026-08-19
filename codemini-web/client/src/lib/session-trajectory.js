const USER_ROLES = new Set(["you", "user"]);
const ERROR_STATUSES = new Set(["failed", "error", "blocked", "aborted"]);

function normalizeRole(message) {
  return String(message?.role || "").toLowerCase();
}

function isUserMessage(message) {
  return USER_ROLES.has(normalizeRole(message));
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

function compactOneLine(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return JSON.stringify(JSON.parse(raw));
  } catch {
    return raw.replace(/\s+/g, " ");
  }
}

export function formatTrajectoryRowPreview(event) {
  if (!event) return "";
  if (event.kind === "tool" || event.kind === "skill") {
    const name = String(event.title || "").trim();
    const input = compactOneLine(event.input || event.body);
    const output = compactOneLine(event.preview || event.output);
    const left = [name, input].filter(Boolean).join(" ");
    return output ? `${left} -> ${output}` : left;
  }
  return firstLinePreview(event.body || event.input || "", 160);
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

function firstLinePreview(text, max = 80) {
  const value = String(text || "").trim();
  if (!value) return "";
  const line = value.split(/\r?\n/).find((part) => part.trim()) || value;
  return truncateTrajectoryText(line.trim(), max);
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
    input: partial.input || "",
    output: partial.output || "",
    status: Object.prototype.hasOwnProperty.call(partial, "status")
      ? partial.status
      : null,
    sourceCard: partial.sourceCard || null,
    loop: Number(partial.loop) > 0 ? Number(partial.loop) : 0,
    startedAt,
    endedAt,
    durationMs: resolveDurationMs({
      startedAt,
      endedAt,
      durationMs: partial.durationMs,
    }),
  };
}

function hasTimelineContent(message) {
  if (!message) return false;
  if (isUserMessage(message)) return true;
  const role = normalizeRole(message);
  if (role === "error" || role === "plan-overview" || isAbortDivider(message)) return true;
  if (Array.isArray(message.segments) && message.segments.length > 0) return true;
  if (message.planOverview) return true;
  return Boolean(messageText(message));
}

function hasConversationMessages(messages) {
  return (Array.isArray(messages) ? messages : []).some(hasTimelineContent);
}

function orderMessagesByTime(messages) {
  return messages
    .map((message, index) => ({ message, index }))
    .sort((a, b) => {
      const ta = toMs(messageTime(a.message));
      const tb = toMs(messageTime(b.message));
      if (ta != null && tb != null && ta !== tb) return ta - tb;
      return a.index - b.index;
    });
}

function buildPlanBody(message) {
  const overview = message?.planOverview || {};
  const goal = String(overview.goal || messageText(message) || "").trim();
  const steps = Array.isArray(overview.steps) ? overview.steps : [];
  const stepLines = steps.map((step) => {
    const index = step?.index != null ? `${step.index}. ` : "";
    const title = String(step?.title || "").trim();
    const status = String(step?.status || "").trim();
    const role = String(step?.role || "").trim();
    return `${index}${title}${status ? ` [${status}]` : ""}${role ? ` (${role})` : ""}`.trim();
  });
  return {
    goal,
    input: [goal, ...stepLines].filter(Boolean).join("\n"),
  };
}

function emitModelSegments(events, message, index, turn) {
  const segments = Array.isArray(message.segments) ? message.segments : [];
  let emittedBody = false;
  let currentLoop = 0;
  const pushEvent = (partial) => {
    events.push(makeEvent({ ...partial, loop: partial.loop || currentLoop }));
  };
  segments.forEach((segment, segmentIndex) => {
    if (segment?.type === "loop") {
      const step = Math.max(1, Number(segment.step) || 1);
      if (segment.phase === "end") {
        const open = [...events]
          .reverse()
          .find((event) => event.kind === "loop" && event.loop === step && event.turn === turn);
        if (open) {
          open.endedAt = segment.endedAt || open.endedAt;
          open.durationMs = resolveDurationMs({
            startedAt: open.startedAt,
            endedAt: open.endedAt,
            durationMs: segment.durationMs,
          });
          const reason = String(segment.reason || "").toLowerCase();
          open.status =
            reason === "abort" || reason === "aborted" ? "error" : "done";
        }
        return;
      }
      currentLoop = step;
      pushEvent({
        id: `trajectory-loop-${message.id || index}-${segmentIndex}`,
        kind: "loop",
        turn,
        loop: step,
        title: `agent loop ${step}`,
        body: `agent loop ${step}`,
        startedAt: segment.startedAt || messageTime(message),
        status: segment.isStreaming ? "running" : null,
      });
      return;
    }
    if (segment?.type === "thinking") {
      if (!segment.text && !segment.isStreaming) return;
      pushEvent({
        id: `trajectory-thinking-${message.id || index}-${segmentIndex}`,
        kind: "thinking",
        turn,
        title: "thinking",
        body: segment.text || "",
        input: segment.text || "",
        status: segment.isStreaming ? "running" : "done",
        startedAt: segment.startedAt || messageTime(message),
        endedAt: segment.endedAt || null,
        durationMs: segment.durationMs,
      });
      return;
    }
    if (segment?.type === "text") {
      if (!segment.text && !segment.isStreaming) return;
      emittedBody = true;
      pushEvent({
        id: `trajectory-body-${message.id || index}-${segmentIndex}`,
        kind: "assistant",
        turn,
        title: "body",
        body: segment.text || "",
        input: segment.text || "",
        status: segment.isStreaming ? "running" : "done",
        startedAt: segment.startedAt || messageTime(message),
        endedAt: segment.endedAt || null,
        durationMs: segment.durationMs,
      });
      return;
    }
    if (segment?.type === "handoff") {
      if (!segment.text && !segment.isStreaming) return;
      pushEvent({
        id: `trajectory-handoff-${message.id || index}-${segmentIndex}`,
        kind: "assistant",
        turn,
        title: "handoff",
        body: segment.text || "",
        input: segment.text || "",
        status: segment.isStreaming ? "running" : "done",
        startedAt: segment.startedAt || messageTime(message),
        endedAt: segment.endedAt || null,
      });
      return;
    }
    if (segment?.type === "skill") {
      const detail = buildSkillDetail(segment);
      pushEvent({
        id: `trajectory-skill-${message.id || index}-${segmentIndex}`,
        kind: "skill",
        turn,
        title: segment.name || "skill",
        body: segment.summary || detail,
        input: detail,
        output: segment.summary || "",
        status: normalizeStatus(segment.status, segment.isStreaming),
        startedAt: segment.startedAt || null,
        endedAt: segment.endedAt || null,
      });
      return;
    }
    if (segment?.type !== "tools" || !Array.isArray(segment.cards)) return;
    segment.cards.forEach((card, cardIndex) => {
      const input = stringifyTrajectoryValue(card?.arguments);
      const output =
        stringifyTrajectoryValue(card?.result) ||
        (typeof card?.summary === "string" ? card.summary : "");
      pushEvent({
        id: `trajectory-tool-${card?.id || `${message.id || index}-${cardIndex}`}`,
        kind: "tool",
        turn,
        title: card?.name || "tool",
        body: input,
        preview:
          typeof card?.summary === "string" && card.summary
            ? card.summary
            : output,
        input,
        output,
        status: normalizeStatus(card?.status, card?.isStreaming),
        startedAt: card?.startedAt || null,
        endedAt: card?.endedAt || null,
        durationMs: card?.durationMs,
        sourceCard: card,
      });
    });
  });
  if (!emittedBody) {
    const fallback = messageText(message);
    if (fallback) {
      pushEvent({
        id: `trajectory-body-${message.id || index}`,
        kind: "assistant",
        turn,
        title: "body",
        body: fallback,
        input: fallback,
        startedAt: messageTime(message),
      });
    }
  }
}

function buildSkillDetail(segment = {}) {
  const lines = [];
  const push = (label, value) => {
    const text = String(value || "").trim();
    if (text) lines.push(`${label}: ${text}`);
  };
  push("name", segment.name);
  push("event", segment.event);
  push("kind", segment.kind);
  push("source", segment.sourceLabel || segment.source);
  push("tool", segment.toolName);
  push("matcher", segment.matcher);
  push("command", segment.command);
  push("status", segment.status);
  push("reason", segment.reason);
  const summary = String(segment.summary || "").trim();
  if (summary) lines.push(summary);
  return lines.join("\n");
}

function collectUserSkillBadges(message) {
  const badges = Array.isArray(message?.skillBadges) ? message.skillBadges : [];
  const names = Array.isArray(message?.selectedSkillNames)
    ? message.selectedSkillNames
    : [];
  const seen = new Set();
  const out = [];
  for (const badge of badges) {
    const name = String(badge?.name || "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(badge);
  }
  for (const raw of names) {
    const name = String(raw || "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, status: "selected" });
  }
  return out;
}

function emitUserSkills(events, message, index, turn) {
  collectUserSkillBadges(message).forEach((badge, badgeIndex) => {
    const detail = buildSkillDetail(badge);
    events.push(
      makeEvent({
        id: `trajectory-skill-user-${message.id || index}-${badgeIndex}`,
        kind: "skill",
        turn,
        title: badge.name || "skill",
        body: detail || badge.name,
        input: detail,
        status: normalizeStatus(badge.status, false),
      }),
    );
  });
}

export function buildTrajectory({
  messages = [],
  runtimeState = null,
  projectCwd = "",
  isGeneral = false,
  systemPrompt = "",
} = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const events = [];

  if (hasConversationMessages(list)) {
    const prompt = String(systemPrompt || runtimeState?.lastSystemPrompt || "").trim();
    const full = prompt || buildSystemBody(runtimeState);
    events.push(
      makeEvent({
        id: "trajectory-system",
        kind: "system",
        turn: 0,
        title: "SYSTEM",
        body: firstLinePreview(full),
        input: full,
      }),
    );
  }

  let turn = 0;
  let emittedContext = false;

  orderMessagesByTime(list).forEach(({ message, index }) => {
    const role = normalizeRole(message);

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
        const context = buildContextBody({ runtimeState, projectCwd, isGeneral });
        events.push(
          makeEvent({
            id: "trajectory-context",
            kind: "context",
            turn,
            title: "CONTEXT",
            body: context,
            input: context,
          }),
        );
      }
      emitUserSkills(events, message, index, turn);
      return;
    }

    const activeTurn = Math.max(turn, 1);

    if (isAbortDivider(message)) {
      events.push(
        makeEvent({
          id: `trajectory-abort-${message.id || index}`,
          kind: "assistant",
          turn: activeTurn,
          title: "abort",
          body: messageText(message),
          status: "error",
          startedAt: messageTime(message),
        }),
      );
      return;
    }

    if (role === "divider") {
      const text = messageText(message);
      if (!text) return;
      events.push(
        makeEvent({
          id: `trajectory-divider-${message.id || index}`,
          kind: "assistant",
          turn: activeTurn,
          title: "divider",
          body: text,
          startedAt: messageTime(message),
        }),
      );
      return;
    }

    if (role === "system") {
      const text = messageText(message);
      if (!text) return;
      events.push(
        makeEvent({
          id: `trajectory-notice-${message.id || index}`,
          kind: "system",
          turn: activeTurn,
          title: "system",
          body: text,
          input: text,
          startedAt: messageTime(message),
        }),
      );
      return;
    }

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

    if (role === "plan-overview" || message.planOverview) {
      const plan = buildPlanBody(message);
      if (!plan.goal && !plan.input) return;
      events.push(
        makeEvent({
          id: `trajectory-plan-${message.id || index}`,
          kind: "assistant",
          turn: activeTurn,
          title: "plan",
          body: plan.goal,
          input: plan.input || plan.goal,
          startedAt: messageTime(message),
        }),
      );
      return;
    }

    emitModelSegments(events, message, index, activeTurn);
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
    const haystack = [
      event.kind,
      event.title,
      event.body,
      event.preview,
      event.input,
      event.output,
    ]
      .map((part) => String(part || "").toLowerCase())
      .join("\n");
    return haystack.includes(needle);
  });
}
