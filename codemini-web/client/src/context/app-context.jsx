import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { t } from "../../i18n/index.js";
import * as api from "../hooks/use-api.js";

const AppContext = createContext(null);

function isProjectIndexEvent(event) {
  const name = String(event?.name || "").toLowerCase();
  const summary = String(event?.summary || "").toLowerCase();
  return (
    name.includes("project_index") ||
    name.includes("initializeprojectindex") ||
    summary.includes("project_index(") ||
    (summary.includes("initialized ") && summary.includes("/.codemini"))
  );
}

function parseRoute() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const params = new URLSearchParams(window.location.search);
  const chatMatch = path.match(/^\/chat\/([^/]+)$/);
  if (chatMatch)
    return { view: "chat", sessionId: decodeURIComponent(chatMatch[1]) };
  if (path === "/codewiki")
    return { view: "codewiki", projectPath: params.get("project") || "" };
  return { view: "chat" };
}

function routeFor(view, sessionId, options = {}) {
  if (view === "codewiki") {
    const projectPath = String(options.projectPath || "").trim();
    return projectPath
      ? `/codewiki?project=${encodeURIComponent(projectPath)}`
      : "/codewiki";
  }
  return sessionId ? `/chat/${encodeURIComponent(sessionId)}` : "/";
}

function updateRoute(
  view,
  sessionId,
  { replace = false, projectPath = "" } = {},
) {
  const next = routeFor(view, sessionId, { projectPath });
  if (`${window.location.pathname}${window.location.search}` === next) return;
  const st = {
    view,
    sessionId: sessionId || null,
    projectPath: projectPath || null,
  };
  if (replace) window.history.replaceState(st, "", next);
  else window.history.pushState(st, "", next);
}

function projectNameFromRuntimeState(rs = {}) {
  if (rs.isGeneral) return "__codemini_general__";
  return rs.cwd?.split(/[/\\]/).pop() || rs.cwd || "...";
}

const initialState = {
  stage: "idle",
  busy: false,
  currentView: "chat",
  runtimeState: null,
  live: false,
  stageLabel: "",
  messages: [],
  activeMsgId: null,
  pendingToolChanges: [],
  planSteps: [],
  pendingPlanApproval: null,
  pendingSpecApproval: null,
  pendingReflectApproval: null,
  runtimeActivities: [],
  approvalRequest: null,
  config: null,
  configStatus: null,
  configOpen: false,
  projectOpen: false,
  skillsOpen: false,
  memoryOpen: false,
  soulsOpen: false,
  aboutOpen: false,
  gitDiffOpen: false,
  sessions: [],
  projectCwd: null,
  isGeneral: false,
  history: [],
  skills: [],
  gitInfo: null,
  gitBatch: {},
  codewikiProjectPath: "",
  codewikiGeneration: { status: "idle", updatedAt: null, error: "" },
  versionInfo: null,
  updateStatus: null,
  initialLoading: true,
  sessionsLoading: false,
  messagesLoading: false,
};

const DEFAULT_RUNTIME_ACTIVITY_CLEAR_MS = 6500;

function runtimeActivityStatus(activity) {
  return activity?.status || "done";
}

function isStickyRuntimeActivity(activity) {
  const key = activity?.key || activity?.id || "runtime";
  return (
    activity?.sticky === true ||
    (key === "reflect" && runtimeActivityStatus(activity) === "running")
  );
}

function collapseRenderedSkillPrompt(content) {
  const text = String(content || "");
  const match = text.match(/^\[Executing skill: \/([^\]\s]+)\]\n\n/);
  if (!match) return text;

  const skillName = match[1];
  const prefix = `/${skillName}`;
  const currentQuestion = text.match(/\nCurrent question:\n([\s\S]+)$/);
  if (currentQuestion?.[1]?.trim())
    return `${prefix} ${currentQuestion[1].trim()}`;
  return prefix;
}

function updateToolInSegments(segments, toolId, updater) {
  return segments.map((seg) => {
    if (seg.type !== "tools") return seg;
    const idx = seg.cards.findIndex((c) => c.id === toolId);
    if (idx === -1) return seg;
    const newCards = [...seg.cards];
    newCards[idx] = updater(newCards[idx]);
    return { ...seg, cards: newCards };
  });
}

function addToolToSegments(segments, toolCard) {
  if (segments.length === 0) return [{ type: "tools", cards: [toolCard] }];
  const last = segments[segments.length - 1];
  if (last.type === "tools")
    return [
      ...segments.slice(0, -1),
      { ...last, cards: [...last.cards, toolCard] },
    ];
  return [...segments, { type: "tools", cards: [toolCard] }];
}

function addSkillToSegments(segments, event) {
  const now = new Date().toISOString();
  return [
    ...(Array.isArray(segments) ? segments : []),
    {
      type: "skill",
      name: event.name,
      status: "running",
      startedAt: event.startedAt || now,
    },
  ];
}

function updateSkillInSegments(segments, name, updater) {
  const source = Array.isArray(segments) ? segments : [];
  let targetIndex = -1;
  for (let i = source.length - 1; i >= 0; i -= 1) {
    const segment = source[i];
    if (segment?.type === "skill" && segment.name === name && segment.status === "running") {
      targetIndex = i;
      break;
    }
  }
  if (targetIndex === -1) return source;
  return source.map((segment, index) => (index === targetIndex ? updater(segment) : segment));
}

function ensureTextSegment(segments) {
  if (segments.length === 0)
    return [{ type: "text", text: "", isStreaming: false }];
  const last = segments[segments.length - 1];
  if (last.type === "text") return segments;
  return [...segments, { type: "text", text: "", isStreaming: false }];
}

function appendDeltaToSegments(segments, delta) {
  const segs = ensureTextSegment(segments);
  const last = segs[segs.length - 1];
  return [
    ...segs.slice(0, -1),
    { ...last, text: (last.text || "") + delta, isStreaming: true },
  ];
}

function appendThinkingToSegments(segments, delta, isStreaming = true) {
  const value = String(delta || "");
  if (!value) return segments || [];
  const segs = Array.isArray(segments) ? segments : [];
  const now = new Date().toISOString();
  const nowMs = Date.parse(now);
  const last = segs[segs.length - 1];
  if (last?.type === "thinking") {
    const startedAt = last.startedAt || now;
    return [
      ...segs.slice(0, -1),
      {
        ...last,
        text: `${last.text || ""}${value}`,
        isStreaming,
        startedAt,
        endedAt: isStreaming ? null : last.endedAt || now,
        durationMs: Math.max(
          Number(last.durationMs || 0),
          nowMs - Date.parse(startedAt),
        ),
      },
    ];
  }
  return [
    ...segs,
    {
      type: "thinking",
      text: value,
      isStreaming,
      startedAt: now,
      endedAt: isStreaming ? null : now,
      durationMs: isStreaming ? 0 : null,
    },
  ];
}

function resolveThinkingDurationMs(seg, endedAt) {
  const explicit = Number(seg?.durationMs);
  const startMs = Date.parse(seg?.startedAt || "");
  const endMs = Date.parse(seg?.endedAt || endedAt || "");
  const measured =
    Number.isFinite(startMs) && Number.isFinite(endMs)
      ? Math.max(0, endMs - startMs)
      : null;
  if (Number.isFinite(explicit) && measured != null)
    return Math.max(explicit, measured);
  if (Number.isFinite(explicit)) return Math.max(0, explicit);
  return measured;
}

function finishThinkingSegments(segments) {
  const endedAt = new Date().toISOString();
  return (Array.isArray(segments) ? segments : []).map((seg) =>
    seg.type === "thinking"
      ? {
          ...seg,
          isStreaming: false,
          endedAt: seg.endedAt || endedAt,
          durationMs: resolveThinkingDurationMs(seg, endedAt),
        }
      : seg,
  );
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const out = {};
  for (const key of [
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "cachedInputTokens",
    "cacheMissInputTokens",
    "cacheWriteInputTokens",
    "reasoningOutputTokens",
    "requests",
  ]) {
    const value = Number(usage?.[key]);
    if (Number.isFinite(value)) out[key] = Math.max(0, Math.round(value));
  }
  return Object.keys(out).length ? out : null;
}

function mergeUsage(left, right) {
  const a = normalizeUsage(left);
  const b = normalizeUsage(right);
  if (!a) return b;
  if (!b) return a;
  const out = {};
  for (const key of [
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "cachedInputTokens",
    "cacheMissInputTokens",
    "cacheWriteInputTokens",
    "reasoningOutputTokens",
    "requests",
  ]) {
    out[key] = Math.max(
      0,
      Math.round(Number(a[key] || 0) + Number(b[key] || 0)),
    );
  }
  return out;
}

function getReasoningTextFromDetails(details) {
  if (!Array.isArray(details)) return "";
  return details
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      if (block.type === "thinking") return block.thinking || block.text || "";
      if (block.type === "reasoning" || block.type === "reasoning_content")
        return block.text || block.reasoning_content || "";
      if (block.type === "redacted_thinking") return "[redacted thinking]";
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function getMessageReasoningText(msg) {
  return (
    String(msg?.reasoningContent || msg?.reasoning_content || "").trim() ||
    getReasoningTextFromDetails(
      msg?.reasoningDetails || msg?.reasoning_details,
    ).trim()
  );
}

function stripPlanProgressText(text) {
  return String(text || "").replace(
    /(?:^|\n)\[plan\]\s+Step\s+\d+\/\d+\s+->[^\n]*\n?/g,
    "",
  );
}

function fileChangeKey(change) {
  if (!change?.path) return "";
  return JSON.stringify({
    path: String(change.path || ""),
    action: String(change.action || ""),
    linesAdded: Number(change.linesAdded || 0),
    linesRemoved: Number(change.linesRemoved || 0),
    changedLine: Number(change.changedLine || 0),
    diffPreview: String(change.diffPreview || ""),
    changeSetId: String(change.changeSetId || ""),
  });
}

function appendUniqueFileChanges(existing = [], changes = []) {
  const next = Array.isArray(existing) ? [...existing] : [];
  const seen = new Set(next.map(fileChangeKey).filter(Boolean));
  for (const change of Array.isArray(changes) ? changes : [changes]) {
    const key = fileChangeKey(change);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.push(change);
  }
  return next;
}

function buildChangeStateMap(changeSets = []) {
  const map = new Map();
  for (const changeSet of Array.isArray(changeSets) ? changeSets : []) {
    const id = String(changeSet?.id || "").trim();
    if (!id) continue;
    map.set(id, {
      revertedAt: changeSet.revertedAt || null,
    });
  }
  return map;
}

function enrichFileChange(change, changeStateMap) {
  if (!change || typeof change !== "object") return change;
  const id = String(change.changeSetId || "").trim();
  if (!id) return change;
  const state = changeStateMap.get(id);
  if (!state?.revertedAt) return change;
  return { ...change, revertedAt: state.revertedAt };
}

function enrichFileChanges(changes, changeStateMap) {
  if (!Array.isArray(changes) || !changes.length) return changes;
  return changes.map((change) => enrichFileChange(change, changeStateMap));
}

function enrichMessageChangeStates(messages, changeSets = []) {
  const changeStateMap = buildChangeStateMap(changeSets);
  if (!changeStateMap.size) return messages;
  return (Array.isArray(messages) ? messages : []).map((message) => ({
    ...message,
    fileChanges: enrichFileChanges(message.fileChanges, changeStateMap),
    segments: Array.isArray(message.segments)
      ? message.segments.map((segment) => {
          if (segment?.type !== "tools" || !Array.isArray(segment.cards))
            return segment;
          return {
            ...segment,
            cards: segment.cards.map((card) => ({
              ...card,
              fileChange: enrichFileChange(card.fileChange, changeStateMap),
              fileChanges: enrichFileChanges(card.fileChanges, changeStateMap),
            })),
          };
        })
      : message.segments,
  }));
}

function markMessagesChangesReverted(
  messages,
  ids = [],
  revertedAt = new Date().toISOString(),
) {
  const set = new Set(
    (Array.isArray(ids) ? ids : [ids])
      .map((id) => String(id || "").trim())
      .filter(Boolean),
  );
  if (!set.size) return messages;
  const markChange = (change) => {
    if (!change || typeof change !== "object") return change;
    return set.has(String(change.changeSetId || "").trim())
      ? { ...change, revertedAt }
      : change;
  };
  return (Array.isArray(messages) ? messages : []).map((message) => ({
    ...message,
    fileChanges: Array.isArray(message.fileChanges)
      ? message.fileChanges.map(markChange)
      : message.fileChanges,
    segments: Array.isArray(message.segments)
      ? message.segments.map((segment) => {
          if (segment?.type !== "tools" || !Array.isArray(segment.cards))
            return segment;
          return {
            ...segment,
            cards: segment.cards.map((card) => ({
              ...card,
              fileChange: markChange(card.fileChange),
              fileChanges: Array.isArray(card.fileChanges)
                ? card.fileChanges.map(markChange)
                : card.fileChanges,
            })),
          };
        })
      : message.segments,
  }));
}

// Helper to update messages immutably while preserving all other state
function mapMessages(prev, activeId, mapper) {
  return {
    ...prev,
    messages: prev.messages.map((m) => (m.id === activeId ? mapper(m) : m)),
  };
}

function removeTransientMessages(messages, keys) {
  const set = new Set(Array.isArray(keys) ? keys : [keys]);
  return messages.filter((m) => {
    if (set.has(m.transientKey)) return false;
    const text = String(m.text || "");
    if (
      set.has("plan-waiting-review") &&
      (text.includes("等待计划审阅") ||
        text.includes("Waiting for plan review"))
    )
      return false;
    if (
      set.has("waiting-response") &&
      (text.includes("等待回复") || text.includes("Waiting for response"))
    )
      return false;
    return true;
  });
}

function isPlanSystemSummaryText(text) {
  const value = String(text || "");
  return (
    value.includes("Auto plan finished") ||
    value.includes("Plan created and waiting for approval") ||
    value.includes("Pending plan approval") ||
    (value.includes("Plan File:") && value.includes("/yes"))
  );
}

function isReflectSystemSummaryText(text) {
  const value = String(text || "");
  return (
    value.includes("Reflect skill draft pending.") ||
    value.includes("Reflect skill draft revised.") ||
    value.includes("Reflect skill written and loaded:") ||
    value.includes("Reflect skill draft discarded.")
  );
}

function getRuntimeActivityFromSystemText(text) {
  const value = String(text || "").trim();
  if (value.startsWith("Reflect skill written and loaded:")) {
    const command = value.match(/\/[A-Za-z0-9_-]+/)?.[0] || "";
    return {
      key: "reflect",
      status: "done",
      emoji: "✨",
      label: t("runtimeActivityReflectSaved"),
      detail: command,
    };
  }
  if (value.startsWith("Reflect skill draft revised.")) {
    return {
      key: "reflect",
      status: "running",
      emoji: "📝",
      label: t("runtimeActivityReflectRevised"),
    };
  }
  if (value.startsWith("Reflect skill draft pending.")) {
    return {
      key: "reflect",
      status: "running",
      emoji: "🪞",
      label: t("runtimeActivityReflectPending"),
    };
  }
  if (value.startsWith("Reflect skill draft discarded.")) {
    return {
      key: "reflect",
      status: "done",
      emoji: "🗑️",
      label: t("runtimeActivityReflectDiscarded"),
    };
  }
  if (value.startsWith("Reflect found no reusable skill candidate.")) {
    return {
      key: "reflect",
      status: "done",
      emoji: "🪞",
      label: t("runtimeActivityReflectNone"),
    };
  }
  if (value.startsWith("Dream failed:")) {
    return {
      key: "dream",
      status: "error",
      emoji: "⚠️",
      label: t("runtimeActivityDreamError"),
      detail: value.slice("Dream failed:".length).trim(),
    };
  }
  if (value.startsWith("Dream done")) {
    return {
      key: "dream",
      status: "done",
      emoji: "🌙",
      label: t("runtimeActivityDreamDone"),
    };
  }
  if (value.startsWith("Micro-compact")) {
    return {
      key: "compact",
      status: "done",
      emoji: "🪄",
      label: value.includes(" preview")
        ? t("runtimeActivityMicroCompactPreview")
        : t("runtimeActivityMicroCompactDone"),
      detail: value.split("\n")[0],
    };
  }
  if (
    value.startsWith("Compact ") ||
    value === "Context restored to full view"
  ) {
    return {
      key: "compact",
      status: "done",
      emoji: "🧳",
      label: value.includes(" preview")
        ? t("runtimeActivityCompactPreview")
        : t("runtimeActivityCompactDone"),
      detail: value.split("\n")[0],
    };
  }
  if (value.startsWith("Captured to inbox:")) {
    return {
      key: "inbox",
      status: "done",
      emoji: "📥",
      label: t("runtimeActivityInboxCaptured"),
    };
  }
  if (value.startsWith("Inbox (") || value === "Inbox is empty.") {
    return {
      key: "inbox",
      status: "done",
      emoji: "📬",
      label: t("runtimeActivityInboxListed"),
    };
  }
  return null;
}

function restoreRuntimeActivitiesFromMessages(messages) {
  const byKey = new Map();
  for (const msg of messages || []) {
    if (msg?.role !== "assistant") continue;
    const activity = getRuntimeActivityFromSystemText(msg.content);
    if (!activity) continue;
    if (!isStickyRuntimeActivity(activity)) continue;
    const key = activity.key || "runtime";
    byKey.set(key, {
      id: `runtime-${key}`,
      key,
      status: runtimeActivityStatus(activity),
      emoji: activity.emoji || "•",
      label: activity.label || "",
      detail: activity.detail || "",
      timestamp: msg.at || new Date().toISOString(),
    });
  }
  return [...byKey.values()]
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, 3);
}

function isPlanApprovalLine(line) {
  const value = String(line || "")
    .trim()
    .toLowerCase();
  return (
    [
      "yes",
      "y",
      "/yes",
      "/plan approve",
      "approve",
      "approved",
      "no",
      "n",
      "/no",
      "/reject",
    ].includes(value) || value.startsWith("/edit ")
  );
}

function isPlanApprovalCommandLine(line) {
  const value = String(line || "")
    .trim()
    .toLowerCase();
  return (
    ["/yes", "/plan approve", "/no", "/reject"].includes(value) ||
    value.startsWith("/edit ")
  );
}

function isWorkflowCommandLine(line) {
  const value = String(line || "").trim();
  return (
    isPlanApprovalCommandLine(value) ||
    /^\/(?:plan|spec|reflect)(?:\s|$)/i.test(value)
  );
}

function isWorkflowControlLine(line, state = {}) {
  const trimmed = String(line || "").trim();
  const value = trimmed.toLowerCase();
  if (!trimmed) return false;
  if (isPlanApprovalLine(trimmed)) return true;
  if (/^\/(?:plan|spec|reflect)(?:\s|$)/i.test(trimmed)) return true;
  const mode = String(state.runtimeState?.mode || "").toLowerCase();
  if ((mode === "plan" || mode === "spec") && !trimmed.startsWith("/"))
    return true;
  return false;
}

function createPlanStepMessage(event) {
  const id = `plan-step-${event.step}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    role: event.role || "general",
    isComplete: false,
    text: "",
    segments: [],
    skillBadges: [],
    fileChanges: [],
    timestamp: new Date().toISOString(),
    planStep: {
      step: event.step,
      total: event.total,
      role: event.role || "general",
      title: event.title || "",
      status: "running",
      summary: "",
    },
  };
}

function createPlanOverviewMessage(event, suffix = "") {
  const steps = (event.steps || []).map((s, i) => ({
    index: s.index ?? i + 1,
    title: s.title || "",
    role: s.role || "general",
    status: s.status || "pending",
  }));
  return {
    id: `plan-overview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: "plan-overview",
    text: event.goal || "",
    segments: [],
    skillBadges: [],
    fileChanges: [],
    timestamp: new Date().toISOString(),
    planOverview: {
      goal: event.goal || "",
      steps,
    },
  };
}

function createPlanOverviewFromSteps(goal, steps) {
  return {
    id: `plan-overview-hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: "plan-overview",
    text: goal || "",
    segments: [],
    skillBadges: [],
    fileChanges: [],
    timestamp: new Date().toISOString(),
    planOverview: {
      goal: goal || "",
      steps: (steps || []).map((s, i) => ({
        index: s.index ?? i + 1,
        title: s.title || "",
        role: s.role || "general",
        status: s.status || "done",
      })),
    },
  };
}

function parseHistoricalPlanSummary(text) {
  const value = String(text || "");
  const pattern = /^\[(DONE|FAILED|RUNNING)\]\s+([A-Za-z0-9_-]+):\s*(.*)$/gm;
  const matches = [...value.matchAll(pattern)];
  if (
    !matches.length ||
    matches[0].index > value.slice(0, matches[0].index).trim().length
  ) {
    return null;
  }

  return matches.map((match, index) => {
    const next = matches[index + 1];
    const bodyStart = match.index + match[0].length;
    const bodyEnd = next ? next.index : value.length;
    const tag = String(match[1] || "").toLowerCase();
    return {
      step: index + 1,
      total: matches.length,
      status: tag === "failed" ? "failed" : tag === "done" ? "done" : "running",
      role: String(match[2] || "general").toLowerCase(),
      title: String(match[3] || "").trim(),
      body: value.slice(bodyStart, bodyEnd).trim(),
    };
  });
}

function createHistoricalPlanStepMessage(block, suffix) {
  const shouldShowBody = block.role === "summarizer";
  return {
    id: `plan-history-${Date.now()}-${suffix}-${block.step}`,
    role: block.role || "general",
    segments:
      shouldShowBody && block.body
        ? [{ type: "text", text: block.body, isStreaming: false }]
        : [],
    skillBadges: [],
    fileChanges: [],
    planStep: {
      step: block.step,
      total: block.total,
      role: block.role || "general",
      title: block.title || "",
      status: block.status || "done",
      summary: "",
    },
  };
}

function createPlanTranscriptMessage(block, suffix) {
  const segments = Array.isArray(block.segments) ? block.segments : [];
  return {
    id: `plan-transcript-${Date.now()}-${suffix}-${block.step || 0}`,
    role: block.role || "general",
    segments,
    skillBadges: [],
    fileChanges: Array.isArray(block.fileChanges) ? block.fileChanges : [],
    usage: normalizeUsage(block.usage),
    planStep: {
      step: block.step,
      total: block.total,
      role: block.role || "general",
      title: block.title || "",
      status: block.status || "done",
      summary: block.summary || "",
    },
  };
}

function normalizeCodeWikiStep(step, index = 0) {
  return {
    index: Number(step?.index || step?.step || index + 1),
    title: step?.title || "",
    role: step?.role || "general",
    status: step?.status || "pending",
  };
}

function applyCodeWikiProgressToSteps(steps, event) {
  const current = Array.isArray(steps) ? steps : [];
  if (event.phase === "steps") {
    return (Array.isArray(event.steps) ? event.steps : []).map(
      normalizeCodeWikiStep,
    );
  }
  const stepNumber = Number(event.step || 0);
  if (!stepNumber) return current;
  const status =
    event.status || (event.phase === "step_done" ? "done" : "running");
  let found = false;
  const next = current.map((step, index) => {
    const normalized = normalizeCodeWikiStep(step, index);
    if (Number(normalized.index) !== stepNumber) return normalized;
    found = true;
    return {
      ...normalized,
      title: event.title || normalized.title,
      role: event.role || normalized.role,
      status,
      summary: event.summary || normalized.summary || "",
    };
  });
  if (!found) {
    next.push({
      index: stepNumber,
      title: event.title || "",
      role: event.role || "general",
      status,
      summary: event.summary || "",
    });
  }
  return next.sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
}

export function AppProvider({ children }) {
  const [state, setState] = useState(initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const activeMsgRef = useRef(null);
  const pendingChangesRef = useRef([]);
  const pendingSkillBadgesRef = useRef([]);
  const planRunPendingRef = useRef(false);
  const planStepMessagesRef = useRef(new Map());
  const planOverviewMsgRef = useRef(null);
  const activityTimersRef = useRef(new Map());
  const sseRef = useRef(null);
  const reconnectRef = useRef(null);

  const update = useCallback((updates) => {
    setState((prev) => ({ ...prev, ...updates }));
  }, []);

  const addMessage = useCallback((msg) => {
    const id =
      msg.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const segments = [];
    if (msg.text)
      segments.push({
        type: "text",
        text: msg.text,
        isStreaming: msg.isStreaming || false,
      });
    const newMsg = {
      ...msg,
      id,
      segments,
      skillBadges: Array.isArray(msg.skillBadges) ? msg.skillBadges : [],
      fileChanges: [],
    };
    setState((prev) => ({ ...prev, messages: [...prev.messages, newMsg] }));
    return id;
  }, []);

  const clearRuntimeActivityLater = useCallback(
    (id, delay = DEFAULT_RUNTIME_ACTIVITY_CLEAR_MS) => {
      clearTimeout(activityTimersRef.current.get(id));
      const timer = setTimeout(() => {
        activityTimersRef.current.delete(id);
        setState((prev) => ({
          ...prev,
          runtimeActivities: prev.runtimeActivities.filter(
            (activity) => activity.id !== id,
          ),
        }));
      }, delay);
      activityTimersRef.current.set(id, timer);
    },
    [],
  );

  const upsertRuntimeActivity = useCallback(
    (activity) => {
      const key = activity.key || activity.id || "runtime";
      const id = `runtime-${key}`;
      const clearAfterMs = Number(activity.clearAfterMs);
      const next = {
        id,
        key,
        status: runtimeActivityStatus(activity),
        emoji: activity.emoji || "•",
        label: activity.label || "",
        detail: activity.detail || "",
        sticky: isStickyRuntimeActivity({ ...activity, key }),
        timestamp: new Date().toISOString(),
      };
      clearTimeout(activityTimersRef.current.get(id));
      activityTimersRef.current.delete(id);
      setState((prev) => ({
        ...prev,
        runtimeActivities: [
          next,
          ...prev.runtimeActivities.filter((item) => item.id !== id),
        ].slice(0, 4),
      }));
      if (next.status !== "running" && !next.sticky) {
        clearRuntimeActivityLater(
          id,
          Number.isFinite(clearAfterMs)
            ? clearAfterMs
            : DEFAULT_RUNTIME_ACTIVITY_CLEAR_MS,
        );
      } else if (next.status === "running" && Number.isFinite(clearAfterMs)) {
        clearRuntimeActivityLater(id, clearAfterMs);
      }
    },
    [clearRuntimeActivityLater],
  );

  const setActiveMsg = useCallback(
    (id) => {
      activeMsgRef.current = id;
      update({ activeMsgId: id });
    },
    [update],
  );

  const loadState = useCallback(async () => {
    try {
      const rs = await api.fetchState();
      const busy = !!rs.busy;
      const codeWikiGenerating = !!rs.codeWikiGenerating;
      setState((prev) => ({
        ...prev,
        runtimeState: rs,
        projectCwd: projectNameFromRuntimeState(rs),
        isGeneral: !!rs.isGeneral,
        pendingPlanApproval: rs?.pendingPlanApproval || null,
        pendingSpecApproval: rs?.pendingSpecApproval || null,
        pendingReflectApproval: rs?.pendingReflectSkill || null,
        busy,
        live: busy || prev.live,
        stage: busy ? "thinking" : prev.stage,
        stageLabel: busy ? t("waitingResponse") : prev.stageLabel,
        codewikiGeneration: codeWikiGenerating
          ? { status: "running", updatedAt: new Date().toISOString(), error: "" }
          : prev.codewikiGeneration,
        messages: rs?.pendingPlanApproval
          ? prev.messages
          : removeTransientMessages(prev.messages, "plan-waiting-review"),
      }));
      return rs;
    } catch {
      return null;
    }
  }, [update]);

  const loadConfigStatus = useCallback(
    async ({ openIfRequired = false } = {}) => {
      try {
        const configStatus = await api.fetchConfigStatus();
        update({
          configStatus,
          configOpen:
            openIfRequired && configStatus?.setupRequired
              ? true
              : stateRef.current.configOpen,
        });
        return configStatus;
      } catch {
        return null;
      }
    },
    [update],
  );

  const loadGitInfo = useCallback(async () => {
    try {
      const info = await api.fetchGitInfo();
      update({ gitInfo: info });
    } catch {}
  }, [update]);

  const loadGitBatch = useCallback(
    async (sessions) => {
      const dirs = [
        ...new Set((sessions || []).map((s) => s.projectDir).filter(Boolean)),
      ];
      if (!dirs.length) return;
      try {
        const batch = await api.fetchGitBatch(dirs);
        update({ gitBatch: batch });
      } catch {}
    },
    [update],
  );

  const loadHistory = useCallback(async () => {
    try {
      const history = await api.fetchHistory();
      update({ history: Array.isArray(history) ? history : [] });
    } catch {}
  }, [update]);

  const loadSessions = useCallback(async () => {
    update({ sessionsLoading: true });
    try {
      const sessions = await api.fetchSessions(200);
      const list = Array.isArray(sessions) ? sessions : [];
      update({ sessions: list });
      loadGitBatch(list);
    } catch {
    } finally {
      update({ sessionsLoading: false });
    }
  }, [update, loadGitBatch]);

  const openCodeWikiProjectFromRoute = useCallback(async (projectPath) => {
    if (!projectPath) return null;
    try {
      const currentState = await api.fetchState();
      if (currentState?.cwd === projectPath) return currentState;
      const result = await api.openProject(projectPath);
      if (result?.error) return null;
      return result;
    } catch {
      return null;
    }
  }, []);

  const loadSkills = useCallback(async () => {
    try {
      const skills = await api.fetchSkills();
      update({ skills: Array.isArray(skills) ? skills : [] });
    } catch {}
  }, [update]);

  const loadSessionMessages = useCallback(
    async (sessionData = null) => {
      update({ messagesLoading: true });
      try {
        const data = sessionData || (await api.fetchSessionMessages());
        const messages = Array.isArray(data) ? data : data.messages || [];
        const compactMeta = data?.compact || null;
        const restoredActivities =
          restoreRuntimeActivitiesFromMessages(messages);

        const uiData = sessionData
          ? { messages: [] }
          : await api.fetchSessionUiMessages().catch(() => []);
        const uiMessages = Array.isArray(uiData)
          ? uiData
          : Array.isArray(uiData?.messages)
            ? uiData.messages
            : [];
        if (!messages.length) {
          if (Array.isArray(uiMessages) && uiMessages.length) {
            const changeSets = sessionData
              ? []
              : (await api.fetchSessionChanges().catch(() => ({})))?.changes ||
                [];
            update({
              messages: enrichMessageChangeStates(uiMessages, changeSets),
            });
          } else {
            update({ messages: [], runtimeActivities: [] });
          }
          return;
        }
        const processed = [];
        let assistantGroup = null;
        const compactBoundary = compactMeta?.boundaryIndex;
        let dividerInserted = compactBoundary == null;
        for (let mi = 0; mi < messages.length; mi++) {
          const msg = messages[mi];
          // Insert compact divider at the boundary position
          if (!dividerInserted && mi >= compactBoundary) {
            processed.push({
              id: `msg-compact-divider-${Date.now()}`,
              role: "divider",
              dividerType: "compact",
              text: `以上内容已压缩 (${compactMeta.mode || ""})`,
              timestamp: compactMeta.timestamp || new Date().toISOString(),
            });
            dividerInserted = true;
          }
          if (msg.role === "user") {
            if (isWorkflowCommandLine(msg.content)) continue;
            assistantGroup = null;
            const visibleContent = collapseRenderedSkillPrompt(
              msg.content || "",
            );
            processed.push({
              id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-u${processed.length}`,
              role: "you",
              segments: [
                { type: "text", text: visibleContent, isStreaming: false },
              ],
              skillBadges: [],
              fileChanges: [],
            });
          } else if (msg.role === "assistant") {
            const hiddenActivity = getRuntimeActivityFromSystemText(
              msg.content,
            );
            if (hiddenActivity && isReflectSystemSummaryText(msg.content)) {
              assistantGroup = null;
              continue;
            }

            if (
              Array.isArray(msg.planTranscript) &&
              msg.planTranscript.length
            ) {
              assistantGroup = null;
              const lastUser = [...processed]
                .reverse()
                .find((m) => m.role === "you");
              const goal = lastUser
                ? (lastUser.segments || [])
                    .filter((s) => s.type === "text")
                    .map((s) => s.text)
                    .join(" ") ||
                  lastUser.text ||
                  ""
                : "";
              const planSteps = msg.planTranscript.map((block, i) => ({
                index: block.step || i + 1,
                title: block.title || "",
                role: block.role || "general",
                status: block.status || "done",
              }));
              processed.push(createPlanOverviewFromSteps(goal, planSteps));
              for (const block of msg.planTranscript) {
                processed.push(
                  createPlanTranscriptMessage(block, processed.length),
                );
              }
              continue;
            }

            const planBlocks = parseHistoricalPlanSummary(msg.content);
            if (planBlocks?.length) {
              assistantGroup = null;
              const lastUser = [...processed]
                .reverse()
                .find((m) => m.role === "you");
              const goal = lastUser
                ? (lastUser.segments || [])
                    .filter((s) => s.type === "text")
                    .map((s) => s.text)
                    .join(" ") ||
                  lastUser.text ||
                  ""
                : "";
              processed.push(createPlanOverviewFromSteps(goal, planBlocks));
              const summaryBlock =
                [...planBlocks]
                  .reverse()
                  .find((block) => block.role === "summarizer") ||
                planBlocks[planBlocks.length - 1];
              processed.push(
                createHistoricalPlanStepMessage(
                  {
                    ...summaryBlock,
                    step: 1,
                    total: 1,
                    role: summaryBlock.role || "summarizer",
                  },
                  processed.length,
                ),
              );
              continue;
            }

            if (!assistantGroup) {
              assistantGroup = {
                id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-a${processed.length}`,
                role: "general",
                segments: [],
                skillBadges: [],
                fileChanges: [],
              };
              processed.push(assistantGroup);
            }
            if (Array.isArray(msg.fileChanges) && msg.fileChanges.length) {
              assistantGroup.fileChanges = [
                ...(assistantGroup.fileChanges || []),
                ...msg.fileChanges,
              ];
            }
            assistantGroup.usage = mergeUsage(assistantGroup.usage, msg.usage);
            const reasoningText = getMessageReasoningText(msg);
            if (reasoningText) {
              assistantGroup.segments.push({
                type: "thinking",
                text: reasoningText,
                isStreaming: false,
                startedAt: msg.reasoningStartedAt || msg.at || null,
                endedAt: msg.reasoningEndedAt || msg.at || null,
                durationMs: Number.isFinite(Number(msg.reasoningDurationMs))
                  ? Number(msg.reasoningDurationMs)
                  : null,
              });
            }
            if (msg.content)
              assistantGroup.segments.push({
                type: "text",
                text: msg.content,
                isStreaming: false,
              });
            if (msg.toolCalls && msg.toolCalls.length) {
              const cards = msg.toolCalls.map((tc) => ({
                id: tc.id,
                name: tc.function?.name || tc.name || "tool",
                arguments: tc.function?.arguments || tc.arguments || {},
                status: tc.status || "done",
                durationMs: tc.durationMs,
                summary: tc.summary || "",
                result: "",
                ...(tc.resultMeta ? { resultMeta: tc.resultMeta } : {}),
                ...(tc.fileChange ? { fileChange: tc.fileChange } : {}),
                ...(Array.isArray(tc.fileChanges) && tc.fileChanges.length
                  ? { fileChanges: tc.fileChanges }
                  : {}),
              }));
              assistantGroup.segments.push({
                type: "tools",
                cards,
              });
            }
          } else if (msg.role === "tool" && assistantGroup) {
            const toolId = msg.toolCallId || msg.tool_call_id;
            if (!toolId) continue;
            for (const seg of assistantGroup.segments) {
              if (seg.type !== "tools") continue;
              const card = seg.cards.find((c) => c.id === toolId);
              if (!card) continue;
              if (msg.toolSummary) card.summary = msg.toolSummary;
              if (msg.toolDurationMs != null)
                card.durationMs = msg.toolDurationMs;
              if (msg.toolStatus === "error") card.status = "error";
              if (msg.toolStatus === "blocked") card.status = "blocked";
              if (msg.toolResultMeta) card.resultMeta = msg.toolResultMeta;
              if (msg.content) card.result = msg.content;
              const change = msg.toolFileChange?.path
                ? msg.toolFileChange
                : null;
              if (change?.path) {
                card.fileChange = change;
              }
              if (
                Array.isArray(msg.toolFileChanges) &&
                msg.toolFileChanges.length
              ) {
                card.fileChanges = msg.toolFileChanges;
                assistantGroup.fileChanges = appendUniqueFileChanges(
                  assistantGroup.fileChanges,
                  msg.toolFileChanges,
                );
              } else if (change?.path) {
                assistantGroup.fileChanges = appendUniqueFileChanges(
                  assistantGroup.fileChanges,
                  [change],
                );
              }
              break;
            }
          }
        }
        const changeSets = sessionData
          ? []
          : (await api.fetchSessionChanges().catch(() => ({})))?.changes || [];

        const uiPlanOverview = uiMessages.find(
          (m) => m.role === "plan-overview" && m.planOverview?.goal,
        );
        if (uiPlanOverview) {
          for (let i = 0; i < processed.length; i++) {
            const m = processed[i];
            if (m.role === "plan-overview" && m.planOverview) {
              processed[i] = {
                ...m,
                planOverview: {
                  ...m.planOverview,
                  goal: uiPlanOverview.planOverview.goal || m.planOverview.goal,
                  steps: m.planOverview.steps.map((s, j) => {
                    const uiStep = uiPlanOverview.planOverview.steps?.[j];
                    if (
                      uiStep &&
                      uiStep.status &&
                      uiStep.status !== "pending"
                    ) {
                      return { ...s, status: uiStep.status };
                    }
                    return s;
                  }),
                },
              };
              break;
            }
          }
        }

        update({
          messages: enrichMessageChangeStates(processed, changeSets),
          runtimeActivities: restoredActivities,
        });
      } catch {
      } finally {
        update({ messagesLoading: false });
      }
    },
    [update],
  );

  const handleEvent = useCallback(
    (event) => {
      if (!event?.type) return;
      if (isProjectIndexEvent(event)) return;
      const s = stateRef.current;
      const activeId = activeMsgRef.current;

      switch (event.type) {
        case "connected":
          break;

        case "assistant:start": {
          if (s.currentView !== "chat" && s.currentView !== "codewiki")
            update({ currentView: "chat" });
          setState((prev) => ({
            ...prev,
            messages: removeTransientMessages(
              prev.messages,
              "waiting-response",
            ),
          }));
          if (planRunPendingRef.current) {
            update({
              stage: "thinking",
              busy: true,
              live: true,
              stageLabel: t("thinking"),
            });
            break;
          }
          let msgId = activeId;
          if (!msgId) {
            const pendingSkillBadges = pendingSkillBadgesRef.current;
            pendingSkillBadgesRef.current = [];
            msgId = addMessage({
              role: "general",
              timestamp: new Date().toISOString(),
              text: "",
              isStreaming: false,
              isComplete: false,
              skillBadges: pendingSkillBadges,
            });
            setActiveMsg(msgId);
          } else {
            setState((prev) => ({
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === msgId
                  ? {
                      ...m,
                      isComplete: false,
                      skillBadges: [
                        ...(m.skillBadges || []),
                        ...pendingSkillBadgesRef.current,
                      ],
                    }
                  : m,
              ),
            }));
            pendingSkillBadgesRef.current = [];
          }
          update({
            stage: "thinking",
            busy: true,
            live: true,
            stageLabel: t("thinking"),
          });
          break;
        }

        case "assistant:delta": {
          const delta = stripPlanProgressText(event.text);
          if (activeId && delta) {
            setState((prev) => ({
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === activeId
                  ? {
                      ...m,
                      segments: appendDeltaToSegments(
                        finishThinkingSegments(m.segments),
                        delta,
                      ),
                    }
                  : m,
              ),
            }));
          }
          update({
            stage: "streaming",
            live: true,
            stageLabel: t("streaming"),
          });
          break;
        }

        case "assistant:reasoning_delta": {
          if (activeId && event.text) {
            setState((prev) => ({
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === activeId
                  ? {
                      ...m,
                      segments: appendThinkingToSegments(
                        m.segments,
                        event.text,
                        true,
                      ),
                    }
                  : m,
              ),
            }));
          }
          update({ stage: "thinking", live: true, stageLabel: t("thinking") });
          break;
        }

        case "assistant:tool_call_delta":
          break;

        case "assistant:response": {
          if (activeId) {
            setState((prev) => ({
              ...prev,
              messages: prev.messages.map((m) => {
                if (m.id !== activeId) return m;
                const reasoningText = getMessageReasoningText(
                  event.assistantMessage,
                );
                const withReasoning =
                  reasoningText &&
                  !(Array.isArray(m.segments) ? m.segments : []).some(
                    (seg) =>
                      seg.type === "thinking" && String(seg.text || "").trim(),
                  )
                    ? {
                        ...m,
                        segments: appendThinkingToSegments(
                          m.segments,
                          reasoningText,
                          false,
                        ),
                      }
                    : m;
                if (event.text) {
                  const text = stripPlanProgressText(event.text);
                  const segs = ensureTextSegment(withReasoning.segments);
                  const lastIdx = segs.length - 1;
                  return {
                    ...withReasoning,
                    usage: mergeUsage(
                      withReasoning.usage,
                      event.usage || event.assistantMessage?.usage,
                    ),
                    segments: finishThinkingSegments(segs).map((seg, i) =>
                      i === lastIdx && seg.type === "text"
                        ? { ...seg, text, isStreaming: false }
                        : seg,
                    ),
                  };
                }
                return {
                  ...withReasoning,
                  usage: mergeUsage(
                    withReasoning.usage,
                    event.usage || event.assistantMessage?.usage,
                  ),
                  segments: finishThinkingSegments(withReasoning.segments).map(
                    (seg) =>
                      seg.type === "text"
                        ? { ...seg, isStreaming: false }
                        : seg,
                  ),
                };
              }),
            }));
          }
          break;
        }

        case "tool:start": {
          update({ stage: "tooling", live: true, stageLabel: t("tooling") });
          if (activeId) {
            const toolCard = {
              id: event.id,
              name: event.name,
              arguments: event.arguments,
              status: "running",
              durationMs: null,
              summary: "",
              result: "",
            };
            setState((prev) => ({
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === activeId
                  ? {
                      ...m,
                      segments: addToolToSegments(
                        finishThinkingSegments(m.segments),
                        toolCard,
                      ),
                    }
                  : m,
              ),
            }));
          }
          break;
        }

        case "tool:end": {
          if (activeId) {
            setState((prev) => ({
              ...prev,
              messages: prev.messages.map((m) => {
                if (m.id !== activeId) return m;
                const eventChanges =
                  Array.isArray(event.fileChanges) && event.fileChanges.length
                    ? event.fileChanges
                    : event.fileChange
                      ? [event.fileChange]
                      : [];
                if (eventChanges.length)
                  pendingChangesRef.current = [
                    ...pendingChangesRef.current,
                    ...eventChanges,
                  ];
                return {
                  ...m,
                  fileChanges: eventChanges.length
                    ? appendUniqueFileChanges(m.fileChanges, eventChanges)
                    : m.fileChanges,
                  segments: updateToolInSegments(m.segments, event.id, (tc) => {
                    const u = {
                      ...tc,
                      status: "done",
                      durationMs: event.durationMs,
                    };
                    if (event.summary) u.summary = event.summary;
                    if (event.resultMeta) u.resultMeta = event.resultMeta;
                    if (event.fileChange) u.fileChange = event.fileChange;
                    if (eventChanges.length) u.fileChanges = eventChanges;
                    return u;
                  }),
                };
              }),
            }));
          }
          break;
        }

        case "tool:result": {
          if (activeId) {
            setState((prev) => ({
              ...prev,
              messages: prev.messages.map((m) =>
                m.id !== activeId
                  ? m
                  : {
                      ...m,
                      segments: updateToolInSegments(
                        m.segments,
                        event.id,
                        (tc) => ({ ...tc, result: event.content || "" }),
                      ),
                    },
              ),
            }));
          }
          break;
        }

        case "tool:error": {
          if (activeId) {
            setState((prev) => ({
              ...prev,
              messages: prev.messages.map((m) =>
                m.id !== activeId
                  ? m
                  : {
                      ...m,
                      segments: updateToolInSegments(
                        m.segments,
                        event.id,
                        (tc) => ({
                          ...tc,
                          status: "error",
                          durationMs: event.durationMs,
                          summary: event.summary || tc.summary,
                        }),
                      ),
                    },
              ),
            }));
          }
          break;
        }

        case "tool:blocked": {
          if (activeId) {
            setState((prev) => ({
              ...prev,
              messages: prev.messages.map((m) =>
                m.id !== activeId
                  ? m
                  : {
                      ...m,
                      segments: updateToolInSegments(
                        m.segments,
                        event.id,
                        (tc) => ({
                          ...tc,
                          status: "blocked",
                          summary: t("toolBlocked"),
                        }),
                      ),
                    },
              ),
            }));
          }
          break;
        }

        case "system_tool:start": {
          addMessage({
            role: "system",
            text: `${event.name || "System"}: ${event.summary || ""}`,
            timestamp: new Date().toISOString(),
          });
          break;
        }

        case "plan:steps": {
          const steps = (event.steps || []).map((s, i) => ({
            index: s.index ?? i,
            title: s.title,
            role: s.role,
            status: "pending",
          }));
          planRunPendingRef.current = true;
          planStepMessagesRef.current = new Map();
          setActiveMsg(null);
          const overviewMsg = createPlanOverviewMessage(event);
          planOverviewMsgRef.current = overviewMsg.id;
          setState((prev) => ({
            ...prev,
            planSteps: steps,
            pendingPlanApproval: null,
            messages: [
              ...removeTransientMessages(prev.messages, "waiting-response"),
              overviewMsg,
            ],
          }));
          break;
        }

        case "plan:progress": {
          const { step, status } = event;
          setState((prev) => ({
            ...prev,
            planSteps: prev.planSteps.map((s, i) =>
              i === step - 1 ? { ...s, status } : s,
            ),
            messages: prev.messages.map((m) => {
              if (m.id !== planOverviewMsgRef.current || !m.planOverview)
                return m;
              return {
                ...m,
                planOverview: {
                  ...m.planOverview,
                  steps: m.planOverview.steps.map((s, i) =>
                    i === step - 1 ? { ...s, status } : s,
                  ),
                },
              };
            }),
          }));
          break;
        }

        case "plan:step_start": {
          planRunPendingRef.current = true;
          if (stateRef.current.pendingPlanApproval)
            update({ pendingPlanApproval: null });
          const key = String(event.step);
          let msgId = planStepMessagesRef.current.get(key);
          if (!msgId) {
            const msg = createPlanStepMessage(event);
            msgId = msg.id;
            planStepMessagesRef.current.set(key, msgId);
            setState((prev) => ({
              ...prev,
              messages: [
                ...removeTransientMessages(prev.messages, "waiting-response"),
                msg,
              ].map((m) => {
                if (m.id !== planOverviewMsgRef.current || !m.planOverview)
                  return m;
                return {
                  ...m,
                  planOverview: {
                    ...m.planOverview,
                    steps: m.planOverview.steps.map((s, i) =>
                      i === event.step - 1 ? { ...s, status: "running" } : s,
                    ),
                  },
                };
              }),
            }));
          } else {
            setState((prev) => ({
              ...prev,
              messages: prev.messages.map((m) => {
                if (m.id === msgId)
                  return {
                    ...m,
                    isComplete: false,
                    planStep: { ...(m.planStep || {}), status: "running" },
                  };
                if (m.id === planOverviewMsgRef.current && m.planOverview)
                  return {
                    ...m,
                    planOverview: {
                      ...m.planOverview,
                      steps: m.planOverview.steps.map((s, i) =>
                        i === event.step - 1 ? { ...s, status: "running" } : s,
                      ),
                    },
                  };
                return m;
              }),
            }));
          }
          setActiveMsg(msgId);
          update({
            stage: "tooling",
            busy: true,
            live: true,
            stageLabel: `${event.role || "agent"}: ${event.title || ""}`.trim(),
          });
          break;
        }

        case "plan:step_done": {
          const msgId = planStepMessagesRef.current.get(String(event.step));
          if (msgId) {
            setState((prev) => ({
              ...prev,
              messages: prev.messages.map((m) => {
                if (m.id === msgId) {
                  return {
                    ...m,
                    usage: mergeUsage(m.usage, event.usage),
                    segments: finishThinkingSegments(m.segments).map((seg) =>
                      seg.type === "text"
                        ? { ...seg, isStreaming: false }
                        : seg,
                    ),
                    isComplete: true,
                    planStep: {
                      ...(m.planStep || {}),
                      status: event.status || "done",
                      summary: event.summary || "",
                    },
                  };
                }
                if (m.id === planOverviewMsgRef.current && m.planOverview) {
                  return {
                    ...m,
                    planOverview: {
                      ...m.planOverview,
                      steps: m.planOverview.steps.map((s, i) =>
                        i === event.step - 1
                          ? { ...s, status: event.status || "done" }
                          : s,
                      ),
                    },
                  };
                }
                return m;
              }),
            }));
          }
          break;
        }

        case "plan:pending_approval": {
          setState((prev) => ({
            ...prev,
            messages: [
              ...removeTransientMessages(prev.messages, [
                "plan-waiting-review",
                "waiting-response",
              ]).filter((m) => !isPlanSystemSummaryText(m.text)),
              {
                id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                role: "system",
                text: t("planWaitingReview"),
                segments: [
                  {
                    type: "text",
                    text: t("planWaitingReview"),
                    isStreaming: false,
                  },
                ],
                skillBadges: [],
                fileChanges: [],
                transientKey: "plan-waiting-review",
                timestamp: new Date().toISOString(),
              },
            ],
            pendingPlanApproval: {
              goal: event.goal,
              summary: event.summary,
              filePath: event.filePath,
              steps: event.steps || [],
            },
          }));
          break;
        }
        case "plan:approval_cleared": {
          setState((prev) => ({
            ...prev,
            pendingPlanApproval: null,
            messages: removeTransientMessages(
              prev.messages,
              "plan-waiting-review",
            ),
          }));
          break;
        }

        case "spec:pending_approval": {
          update({ pendingSpecApproval: event.spec || null });
          break;
        }

        case "spec:approval_cleared": {
          update({ pendingSpecApproval: null });
          break;
        }

        case "reflect:pending_approval": {
          upsertRuntimeActivity({
            key: "reflect",
            status: "running",
            emoji: stateRef.current.pendingReflectApproval ? "📝" : "🪞",
            label: stateRef.current.pendingReflectApproval
              ? t("runtimeActivityReflectRevised")
              : t("runtimeActivityReflectPending"),
            detail: event.draft?.name ? `/${event.draft.name}` : "",
          });
          update({ pendingReflectApproval: event.draft || null });
          break;
        }

        case "reflect:approval_cleared": {
          update({ pendingReflectApproval: null });
          break;
        }

        case "skill:start": {
          if (activeId)
            setState((prev) => ({
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === activeId
                  ? {
                      ...m,
                      segments: addSkillToSegments(
                        finishThinkingSegments(m.segments),
                        event,
                      ),
                    }
                  : m,
              ),
            }));
          break;
        }
        case "skill:end": {
          if (activeId)
            setState((prev) => ({
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === activeId
                  ? {
                      ...m,
                      segments: updateSkillInSegments(m.segments, event.name, (segment) => ({
                        ...segment,
                        status: "done",
                        endedAt: event.endedAt || new Date().toISOString(),
                      })),
                    }
                  : m,
              ),
            }));
          break;
        }
        case "skill:error": {
          if (activeId)
            setState((prev) => ({
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === activeId
                  ? {
                      ...m,
                      segments: updateSkillInSegments(m.segments, event.name, (segment) => ({
                        ...segment,
                        status: "error",
                        summary: event.summary,
                        endedAt: event.endedAt || new Date().toISOString(),
                      })),
                    }
                  : m,
              ),
            }));
          break;
        }
        case "skill:always": {
          const names = (event.names || []).join(", ");
          const badge = {
            name: names,
            status: "always",
            startedAt: event.startedAt || new Date().toISOString(),
          };
          if (!names) break;
          if (!activeId) {
            pendingSkillBadgesRef.current = [
              ...pendingSkillBadgesRef.current,
              badge,
            ];
            break;
          }
          if (activeId) {
            setState((prev) => ({
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === activeId
                  ? {
                      ...m,
                      skillBadges: [...m.skillBadges, badge],
                    }
                  : m,
              ),
            }));
          }
          break;
        }

        case "compact:auto":
          upsertRuntimeActivity({
            key: "compact",
            status: "done",
            emoji: "🧳",
            label: t("runtimeActivityCompactDone"),
            detail:
              `${event.mode || "auto"} ${event.threshold ? `${event.threshold}%` : ""}`.trim(),
          });
          addMessage({
            role: "divider",
            dividerType: "compact",
            text: `以上内容已压缩 (${event.mode || ""}, ${event.threshold || ""}%)`,
            timestamp: new Date().toISOString(),
          });
          break;

        case "dream:auto":
          {
            const currentDream = stateRef.current.runtimeActivities.find(
              (activity) => activity.key === "dream",
            );
            const finishedRecently =
              currentDream &&
              currentDream.status !== "running" &&
              Date.now() - Date.parse(currentDream.timestamp || "") < 10000;
            if (finishedRecently) break;
          }
          upsertRuntimeActivity({
            key: "dream",
            status: "running",
            emoji: "💤",
            label: t("runtimeActivityDreamRunning"),
            clearAfterMs: 30 * 60 * 1000,
          });
          break;
        case "dream:complete":
          upsertRuntimeActivity({
            key: "dream",
            status: event.report?.ok === false ? "error" : "done",
            emoji: event.report?.ok === false ? "⚠️" : "🌙",
            label:
              event.report?.ok === false
                ? t("runtimeActivityDreamError")
                : t("runtimeActivityDreamDone"),
            detail: event.report?.error || "",
            clearAfterMs: 2500,
          });
          break;

        case "approval:request":
          update({ approvalRequest: event });
          break;

        case "change:undone": {
          const result = event.result || {};
          const ids =
            Array.isArray(result.changeSetIds) && result.changeSetIds.length
              ? result.changeSetIds
              : result.changeSetId
                ? [result.changeSetId]
                : [];
          if (ids.length) {
            setState((prev) => ({
              ...prev,
              messages: markMessagesChangesReverted(prev.messages, ids),
            }));
          }
          break;
        }

        case "submit:done": {
          const result = event.result || {};
          if (activeId && pendingChangesRef.current.length) {
            setState((prev) => ({
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === activeId
                  ? {
                      ...m,
                      fileChanges: appendUniqueFileChanges(
                        m.fileChanges,
                        pendingChangesRef.current,
                      ),
                    }
                  : m,
              ),
            }));
            pendingChangesRef.current = [];
          }
          if (activeId) {
            setState((prev) => ({
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === activeId
                  ? {
                      ...m,
                      isComplete: true,
                      segments: finishThinkingSegments(m.segments).map((seg) =>
                        seg.type === "text"
                          ? { ...seg, isStreaming: false }
                          : seg,
                      ),
                    }
                  : m,
              ),
            }));
          }
          if (result.type === "system" && result.text) {
            const activity = getRuntimeActivityFromSystemText(result.text);
            if (activity) upsertRuntimeActivity(activity);
            if (
              !stateRef.current.pendingPlanApproval &&
              !stateRef.current.pendingSpecApproval &&
              !stateRef.current.pendingReflectApproval &&
              !isPlanSystemSummaryText(result.text) &&
              !isReflectSystemSummaryText(result.text)
            ) {
              addMessage({
                role: "system",
                text: result.text,
                timestamp: new Date().toISOString(),
              });
            }
          }
          if (result.type === "error" && result.text) {
            addMessage({
              role: "error",
              text: `Failed: ${result.text}`,
              timestamp: new Date().toISOString(),
            });
          }
          setActiveMsg(null);
          planRunPendingRef.current = false;
          planStepMessagesRef.current = new Map();
          planOverviewMsgRef.current = null;
          setState((prev) => ({
            ...prev,
            stage: "idle",
            busy: false,
            live: false,
            stageLabel: "",
            messages: removeTransientMessages(
              prev.messages,
              stateRef.current.pendingPlanApproval ||
                stateRef.current.pendingSpecApproval
                ? "waiting-response"
                : ["waiting-response", "plan-waiting-review"],
            ),
          }));
          loadHistory();
          loadSessions();
          loadGitInfo();
          const rs = stateRef.current.runtimeState;
          if (rs?.sessionId && stateRef.current.currentView === "chat") {
            updateRoute("chat", rs.sessionId, { replace: true });
          }
          break;
        }

        case "mode:changed": {
          const rs = event;
          update({
            runtimeState: {
              ...stateRef.current.runtimeState,
              mode: rs.mode,
              ...rs,
            },
          });
          break;
        }

        case "approval-mode:changed": {
          const rs = event;
          update({
            runtimeState: {
              ...stateRef.current.runtimeState,
              approvalMode: rs.approvalMode,
              ...rs,
            },
          });
          break;
        }

        case "runtime:state": {
          const rs = event.state || {};
          update({
            runtimeState: { ...stateRef.current.runtimeState, ...rs },
            pendingPlanApproval: rs?.pendingPlanApproval || null,
            pendingSpecApproval: rs?.pendingSpecApproval || null,
            pendingReflectApproval: rs?.pendingReflectSkill || null,
            busy: !!rs.busy,
            live: !!rs.busy,
            stage: rs.busy ? stateRef.current.stage : "idle",
            stageLabel: rs.busy ? stateRef.current.stageLabel : "",
          });
          break;
        }

        case "codewiki:generate_progress": {
          const label =
            event.title ||
            event.summary ||
            event.name ||
            stateRef.current.stageLabel ||
            t("generatingCodeWiki");
          const terminalStatus = ["done", "failed", "aborted"].includes(
            String(event.status || "").toLowerCase(),
          );
          setState((prev) => ({
            ...prev,
            stage: terminalStatus ? "idle" : "tooling",
            live: terminalStatus ? false : true,
            busy: terminalStatus ? false : true,
            stageLabel: terminalStatus ? "" : label,
            planSteps: applyCodeWikiProgressToSteps(prev.planSteps, event),
            codewikiGeneration: {
              status: terminalStatus
                ? (String(event.status).toLowerCase() === "failed" ? "error" : "done")
                : "running",
              updatedAt: event.timestamp || new Date().toISOString(),
              error: terminalStatus && String(event.status).toLowerCase() === "failed"
                ? label
                : "",
            },
          }));
          break;
        }

        case "codewiki:generate_done": {
          setState((prev) => ({
            ...prev,
            stage: "idle",
            live: false,
            busy: false,
            stageLabel: "",
            planSteps: [],
            codewikiGeneration: {
              status: "done",
              updatedAt: new Date().toISOString(),
              error: "",
            },
          }));
          loadSessions();
          break;
        }

        case "codewiki:generate_error": {
          setState((prev) => ({
            ...prev,
            stage: "idle",
            live: false,
            busy: false,
            stageLabel: event.message || "",
            planSteps: [],
            codewikiGeneration: {
              status: "error",
              updatedAt: new Date().toISOString(),
              error: event.message || "",
            },
          }));
          break;
        }

        case "runtime:switched": {
          setState((prev) => ({
            ...prev,
            messages: [],
            planSteps: [],
            pendingPlanApproval: null,
            pendingSpecApproval: null,
            pendingReflectApproval: null,
            runtimeActivities: [],
            codewikiGeneration: { status: "idle", updatedAt: null, error: "" },
          }));
          activeMsgRef.current = null;
          pendingChangesRef.current = [];
          loadState();
          loadGitInfo();
          loadHistory();
          loadSessionMessages();
          loadSessions();
          if (stateRef.current.currentView !== "codewiki")
            updateRoute("chat", event.sessionId);
          break;
        }

        case "session:title": {
          if (event.sessionId && event.title) {
            setState((prev) => ({
              ...prev,
              sessions: prev.sessions.map((s) =>
                s.id === event.sessionId ? { ...s, title: event.title } : s,
              ),
            }));
          }
          break;
        }
      }
    },
    [
      addMessage,
      update,
      upsertRuntimeActivity,
      loadGitInfo,
      loadHistory,
      loadSessions,
      loadState,
      loadSessionMessages,
    ],
  );

  const connectSSE = useCallback(() => {
    if (sseRef.current) sseRef.current.close();
    const es = new EventSource("/api/events");
    es.onmessage = (e) => {
      try {
        handleEvent(JSON.parse(e.data));
      } catch (err) {
        console.error("SSE:", err);
      }
    };
    es.onerror = () => {
      es.close();
      clearTimeout(reconnectRef.current);
      reconnectRef.current = setTimeout(connectSSE, 3000);
    };
    sseRef.current = es;
  }, [handleEvent]);

  useEffect(() => {
    (async () => {
      const route = parseRoute();
      const configStatusPromise = loadConfigStatus({ openIfRequired: true });
      const startupEventsPromise = api.fetchStartupEvents().catch(() => []);
      update({
        currentView: route.view,
        codewikiProjectPath:
          route.view === "codewiki"
            ? route.projectPath || ""
            : stateRef.current.codewikiProjectPath,
      });
      if (route.sessionId) {
        try {
          const currentState = await api.fetchState();
          if (currentState.sessionId !== route.sessionId) {
            await api.switchSession(route.sessionId);
          }
        } catch {}
      } else if (route.view === "codewiki" && route.projectPath) {
        await openCodeWikiProjectFromRoute(route.projectPath);
      }

      await configStatusPromise;

      try {
        const startupEvents = await startupEventsPromise;
        for (const ev of startupEvents) {
          if (!ev || isProjectIndexEvent(ev)) continue;
          if (ev.type === "system_tool" || ev.type === "tool") {
            const summary = ev.summary || "";
            if (summary || ev.name) {
              addMessage({
                role: "system",
                text: summary ? `${ev.name}: ${summary}` : ev.name,
                timestamp: new Date().toISOString(),
                startupTodos: ev.arguments?.todos,
              });
            }
          }
        }
      } catch {}

      const rs = await loadState();
      if (route.view === "chat" && rs?.sessionId) {
        updateRoute("chat", rs.sessionId, { replace: true });
      } else if (route.view === "codewiki") {
        const projectPath = route.projectPath || rs?.cwd || "";
        update({ currentView: "codewiki", codewikiProjectPath: projectPath });
        if (projectPath)
          updateRoute("codewiki", null, { replace: true, projectPath });
      }
      await Promise.all([
        loadSessionMessages(),
        loadHistory(),
        loadSessions(),
        loadSkills(),
        loadGitInfo(),
        api
          .fetchVersion()
          .then((versionInfo) => update({ versionInfo }))
          .catch(() => {}),
      ]);
      update({ initialLoading: false });
      connectSSE();
    })();

    const handlePopState = async () => {
      const route = parseRoute();
      update({
        currentView: route.view,
        codewikiProjectPath:
          route.view === "codewiki"
            ? route.projectPath || ""
            : stateRef.current.codewikiProjectPath,
      });
      if (route.sessionId) {
        try {
          const currentState = await api.fetchState();
          if (currentState.sessionId !== route.sessionId) {
            update({ messagesLoading: true });
            setState((prev) => ({ ...prev, messages: [] }));
            await api.switchSession(route.sessionId);
            await loadState();
            await loadSessionMessages();
            loadSessions();
            loadGitInfo();
          }
        } catch {
          update({ messagesLoading: false });
        }
      } else if (route.view === "codewiki") {
        if (route.projectPath)
          await openCodeWikiProjectFromRoute(route.projectPath);
        const rs = await loadState();
        const projectPath = route.projectPath || rs?.cwd || "";
        update({ currentView: "codewiki", codewikiProjectPath: projectPath });
        loadSessions();
        loadGitInfo();
      }
    };
    window.addEventListener("popstate", handlePopState);

    return () => {
      if (sseRef.current) sseRef.current.close();
      clearTimeout(reconnectRef.current);
      for (const timer of activityTimersRef.current.values())
        clearTimeout(timer);
      activityTimersRef.current.clear();
      window.removeEventListener("popstate", handlePopState);
    };
  }, [
    addMessage,
    connectSSE,
    loadConfigStatus,
    loadGitInfo,
    loadHistory,
    loadSessionMessages,
    loadSessions,
    loadSkills,
    loadState,
    openCodeWikiProjectFromRoute,
    update,
  ]);

  const applyTheme = useCallback((mode) => {
    localStorage.setItem("codemini-theme", mode);
    const mq =
      window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
    const resolved =
      mode === "auto" ? (mq && mq.matches ? "dark" : "light") : mode;
    document.documentElement.dataset.theme = resolved;
  }, []);

  const actions = useMemo(
    () => ({
      submit: async (line, options = {}) => {
        if (!line.trim()) return;
        if (stateRef.current.currentView !== "chat" && !options.stayInView)
          update({ currentView: "chat" });
        const approvingPlan =
          !!stateRef.current.pendingPlanApproval && isPlanApprovalLine(line);
        const workflowControl = isWorkflowControlLine(line, stateRef.current);
        if (approvingPlan) planRunPendingRef.current = true;
        if (!workflowControl)
          addMessage({
            role: "you",
            text: line,
            timestamp: new Date().toISOString(),
          });
        const waitingId = workflowControl
          ? null
          : addMessage({
              role: "system",
              text: t("waitingResponse"),
              timestamp: new Date().toISOString(),
              transientKey: "waiting-response",
            });
        update({
          busy: true,
          live: true,
          stage: "thinking",
          stageLabel: t("waitingResponse"),
        });
        try {
          const res = await api.submitLine(line, {
            readOnlyCodeWiki: options.readOnlyCodeWiki === true,
          });
          const result = await res.json().catch(() => ({}));
          if (result?.code === "CONFIG_REQUIRED") {
            update({
              configOpen: true,
              configStatus:
                result.configStatus || stateRef.current.configStatus,
            });
            throw new Error(t("configRequired"));
          }
          if (result?.error)
            throw new Error(result.message || "Request failed");
        } catch (err) {
          if (approvingPlan) planRunPendingRef.current = false;
          if (waitingId)
            setState((prev) => ({
              ...prev,
              messages: prev.messages.filter((m) => m.id !== waitingId),
            }));
          addMessage({
            role: "error",
            text: `Failed: ${err.message}`,
            timestamp: new Date().toISOString(),
          });
          update({ busy: false, live: false });
        }
      },

      abort: async () => {
        try {
          await api.abortRequest();
        } catch {}
      },

      approve: async (id, approved) => {
        update({ approvalRequest: null });
        try {
          await api.submitApproval(id, approved);
        } catch {}
      },

      approvePlan: async (action, feedback) => {
        const plan = stateRef.current.pendingPlanApproval;
        if (!plan) return;
        planRunPendingRef.current = action === "approve";
        if (action === "reject") {
          update({ pendingPlanApproval: null });
        }
        update({
          busy: true,
          live: true,
          stage: "thinking",
          stageLabel: t("waitingResponse"),
        });
        try {
          const command =
            action === "approve"
              ? "/yes"
              : action === "reject"
                ? "/reject"
                : feedback?.trim()
                  ? `/edit ${feedback.trim()}`
                  : "";
          if (!command) {
            update({ busy: false, live: false, stage: "idle", stageLabel: "" });
            return;
          }
          const res = await api.submitLine(command);
          const result = await res.json().catch(() => ({}));
          if (result?.error)
            throw new Error(result.message || "Request failed");
        } catch (err) {
          planRunPendingRef.current = false;
          addMessage({
            role: "error",
            text: `Failed: ${err.message}`,
            timestamp: new Date().toISOString(),
          });
          update({ busy: false, live: false, stage: "idle", stageLabel: "" });
        }
      },

      updatePendingPlan: async (plan) => {
        try {
          const result = await api.updatePendingPlan(plan);
          if (result?.error)
            throw new Error(result.message || "Failed to update plan");
          if (result?.plan) update({ pendingPlanApproval: result.plan });
          return result?.plan || null;
        } catch (err) {
          addMessage({
            role: "error",
            text: `Failed: ${err.message}`,
            timestamp: new Date().toISOString(),
          });
          return null;
        }
      },

      approveReflect: async (action, feedback) => {
        const draft = stateRef.current.pendingReflectApproval;
        if (!draft) return;
        upsertRuntimeActivity({
          key: "reflect",
          status: "running",
          emoji:
            action === "approve" ? "💾" : action === "reject" ? "🗑️" : "📝",
          label:
            action === "approve"
              ? t("runtimeActivityReflectSaving")
              : action === "reject"
                ? t("runtimeActivityReflectDiscarding")
                : t("runtimeActivityReflectRevising"),
          detail: draft.name ? `/${draft.name}` : "",
        });
        if (action === "reject") {
          update({ pendingReflectApproval: null });
        }
        update({
          busy: true,
          live: true,
          stage: "thinking",
          stageLabel: t("waitingResponse"),
        });
        try {
          const command =
            action === "approve"
              ? "/yes"
              : action === "reject"
                ? "/no"
                : feedback?.trim()
                  ? `/edit ${feedback.trim()}`
                  : "";
          if (!command) {
            update({ busy: false, live: false, stage: "idle", stageLabel: "" });
            return;
          }
          const res = await api.submitLine(command);
          const result = await res.json().catch(() => ({}));
          if (result?.error)
            throw new Error(result.message || "Request failed");
        } catch (err) {
          addMessage({
            role: "error",
            text: `Failed: ${err.message}`,
            timestamp: new Date().toISOString(),
          });
          update({ busy: false, live: false, stage: "idle", stageLabel: "" });
        }
      },

      updatePendingReflect: async (draft) => {
        try {
          const result = await api.updatePendingReflect(draft);
          if (result?.error)
            throw new Error(result.message || "Failed to update reflect draft");
          if (result?.draft) update({ pendingReflectApproval: result.draft });
          return result?.draft || null;
        } catch (err) {
          addMessage({
            role: "error",
            text: `Failed: ${err.message}`,
            timestamp: new Date().toISOString(),
          });
          return null;
        }
      },

      approveSpec: async (action) => {
        const spec = stateRef.current.pendingSpecApproval;
        if (!spec) return;
        if (action === "reject" || action === "save" || action === "delete") {
          update({ pendingSpecApproval: null });
        }
        update({
          busy: true,
          live: true,
          stage: "thinking",
          stageLabel: t("waitingResponse"),
        });
        try {
          if (action === "delete") {
            const result = await api.deletePendingSpec();
            if (result?.error)
              throw new Error(result.message || "Failed to delete spec");
            update({ busy: false, live: false, stage: "idle", stageLabel: "" });
            return;
          }
          const command =
            action === "save"
              ? "/spec save"
              : action === "execute"
                ? "/spec execute"
                : action === "approve"
                  ? "/spec plan"
                  : "/reject";
          const res = await api.submitLine(command);
          const result = await res.json().catch(() => ({}));
          if (result?.error)
            throw new Error(result.message || "Request failed");
        } catch (err) {
          addMessage({
            role: "error",
            text: `Failed: ${err.message}`,
            timestamp: new Date().toISOString(),
          });
          update({ busy: false, live: false, stage: "idle", stageLabel: "" });
        }
      },

      updatePendingSpec: async (spec) => {
        try {
          const result = await api.updatePendingSpec(spec);
          if (result?.error)
            throw new Error(result.message || "Failed to update spec");
          if (result?.spec) update({ pendingSpecApproval: result.spec });
          return result?.spec || null;
        } catch (err) {
          addMessage({
            role: "error",
            text: `Failed: ${err.message}`,
            timestamp: new Date().toISOString(),
          });
          return null;
        }
      },

      openSpecReview: async (spec) => {
        if (!spec?.path) return null;
        try {
          const result = await api.openSpecReview(spec.path);
          if (result?.error)
            throw new Error(result.message || "Failed to open spec");
          if (result?.spec) update({ pendingSpecApproval: result.spec });
          return result?.spec || null;
        } catch (err) {
          addMessage({
            role: "error",
            text: `Failed: ${err.message}`,
            timestamp: new Date().toISOString(),
          });
          return null;
        }
      },

      dismissPlanProgress: () => update({ planSteps: [] }),

      switchSession: async (sessionId) => {
        const currentSessionId = stateRef.current.runtimeState?.sessionId;
        if (!sessionId || sessionId === currentSessionId) return;
        update({ currentView: "chat", messagesLoading: true });
        setState((prev) => ({ ...prev, messages: [] }));
        try {
          const result = await api.switchSession(sessionId);
          if (result.ok) {
            updateRoute("chat", sessionId);
            if (result.state)
              update({
                runtimeState: result.state,
                projectCwd: projectNameFromRuntimeState(result.state),
                isGeneral: !!result.state.isGeneral,
              });
            else await loadState();
            await loadSessionMessages(result.sessionData);
            loadSessions();
            loadGitInfo();
          } else {
            update({ messagesLoading: false });
          }
        } catch {
          update({ messagesLoading: false });
        }
      },

      deleteSession: async (sessionId) => {
        try {
          const deletingCurrent =
            sessionId === stateRef.current.runtimeState?.sessionId;
          const result = await api.deleteSession(sessionId);
          if (result?.error) return result;
          setState((prev) => ({
            ...prev,
            sessions: prev.sessions.filter(
              (session) => session.id !== sessionId,
            ),
          }));
          if (deletingCurrent) {
            update({ currentView: "chat", messagesLoading: true });
            if (result.sessionId)
              updateRoute("chat", result.sessionId, { replace: true });
            if (result.state)
              update({
                runtimeState: result.state,
                projectCwd: projectNameFromRuntimeState(result.state),
                isGeneral: !!result.state.isGeneral,
              });
            else await loadState();
            setState((prev) => ({ ...prev, messages: [] }));
            await loadSessionMessages(result.sessionData);
            loadGitInfo();
          }
          loadSessions();
          return result;
        } catch (err) {
          return { error: true, message: err.message };
        }
      },

      newSession: async () => {
        update({ currentView: "chat", messagesLoading: true });
        setState((prev) => ({ ...prev, messages: [] }));
        try {
          const result = await api.newSession();
          if (result.ok) {
            if (result.sessionId) updateRoute("chat", result.sessionId);
            await loadState();
            loadSessions();
            update({ messagesLoading: false });
          } else {
            update({ messagesLoading: false });
          }
        } catch {
          update({ messagesLoading: false });
        }
      },

      openProject: async (projectPath, options = {}) => {
        const nextView = options.view || "chat";
        const pendingCodeWikiProjectPath =
          nextView === "codewiki"
            ? projectPath
            : stateRef.current.codewikiProjectPath;
        update({
          currentView: nextView,
          projectOpen: false,
          messagesLoading: nextView === "chat",
          codewikiProjectPath: pendingCodeWikiProjectPath,
        });
        if (nextView === "chat")
          setState((prev) => ({ ...prev, messages: [] }));
        try {
          const result = await api.openProject(projectPath);
          if (result.ok) {
            const nextCodeWikiProjectPath =
              nextView === "codewiki"
                ? result.cwd || projectPath
                : stateRef.current.codewikiProjectPath;
            update({
              currentView: nextView,
              projectOpen: false,
              codewikiProjectPath: nextCodeWikiProjectPath,
            });
            if (nextView === "codewiki")
              updateRoute("codewiki", null, {
                projectPath: nextCodeWikiProjectPath,
              });
            else if (result.sessionId) updateRoute("chat", result.sessionId);
            await loadState();
            loadSessions();
            loadGitInfo();
            if (nextView === "chat") update({ messagesLoading: false });
          } else if (nextView === "chat") {
            update({ messagesLoading: false });
          }
        } catch {
          if (nextView === "chat") update({ messagesLoading: false });
        }
      },

      switchView: (view, options = {}) => {
        const codewikiProjectPath =
          view === "codewiki"
            ? options.projectPath ||
              stateRef.current.codewikiProjectPath ||
              stateRef.current.runtimeState?.cwd ||
              ""
            : stateRef.current.codewikiProjectPath;
        update({ currentView: view, codewikiProjectPath });
        if (view === "codewiki") {
          updateRoute(view, null, { projectPath: codewikiProjectPath });
        }
        if (view === "chat") {
          const rs = stateRef.current.runtimeState;
          updateRoute("chat", rs?.sessionId);
        }
      },

      toggleTheme: () => {
        const stored = localStorage.getItem("codemini-theme") || "auto";
        const cycle = { light: "dark", dark: "auto", auto: "light" };
        const next = cycle[stored] || "auto";
        applyTheme(next);
      },

      setTheme: applyTheme,

      setConfigOpen: (open) => update({ configOpen: open }),
      refreshConfigStatus: () => loadConfigStatus(),
      setProjectOpen: (open) => update({ projectOpen: open }),
      setSkillsOpen: (open) => update({ skillsOpen: open }),
      setMemoryOpen: (open) => update({ memoryOpen: open }),
      setSoulsOpen: (open) => update({ soulsOpen: open }),
      setAboutOpen: (open) => update({ aboutOpen: open }),
      setGitDiffOpen: (open) => update({ gitDiffOpen: open }),

      checkVersion: async () => {
        try {
          const info = await api.fetchVersion();
          update({ versionInfo: info });
        } catch {}
      },

      runUpdate: async () => {
        update({ updateStatus: "updating" });
        try {
          const result = await api.runUpdate();
          if (result.ok) {
            update({ updateStatus: "done" });
          } else {
            update({ updateStatus: "error" });
          }
        } catch {
          update({ updateStatus: "error" });
        }
      },
    }),
    [
      addMessage,
      applyTheme,
      loadConfigStatus,
      loadGitInfo,
      loadHistory,
      loadSessionMessages,
      loadSessions,
      loadState,
      update,
      upsertRuntimeActivity,
    ],
  );

  const value = useMemo(() => ({ state, actions }), [state, actions]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
