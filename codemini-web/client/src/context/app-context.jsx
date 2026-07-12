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
import { extractReasoningRuntimePatch } from "../lib/reasoning-controls.js";
import { parseAttachmentsFromModelContent } from "../lib/message-attachments.js";
import { CHAT_ACTION_NAMES, LOCAL_SPEC_REVIEW_ACTIONS } from "../lib/chat-action-names.js";
import {
  operationKey,
  waitForAcceptedOperation,
} from "../lib/chat-operation-waiter.js";
import {
  finishInitialization,
  hydrateBeforeConnect,
} from "../lib/async-lifecycle.js";
import {
  activateSession,
  alignSessionAssistantMessages,
  alignSessionUserMessages,
  hydrateSessionRuntimes,
  mergeAlignedAssistantSkillContext,
  mergeAlignedUserContext,
  projectVisibleSessionState,
  reconcileSessionMessages,
  reduceSessionEvent,
  runSessionOperation,
} from "../lib/session-state.js";
import {
  ACTIVE_SESSION_STATUSES,
  activeSessionIds,
  abortSessionIds,
  buildConversationStartSidebarEntry,
  projectSessionRuntime,
  upsertSidebarSession,
} from "../lib/session-ui-state.js";
import {
  addSkillToSegments,
  finishStreamingTextSegments,
  finishThinkingSegments,
  mergeUsage,
  normalizeUsage,
  updateSkillInSegments,
} from "../../../shared/transcript-segments.js";
import { skillBadgesFromSessionMessage } from "../lib/user-skill-prompt.js";

const AppContext = createContext(null);

function isAbortRelatedText(text = "") {
  const trimmed = String(text || "").trim();
  return (
    /^Aborted:/i.test(trimmed) ||
    /^Failed:\s*This operation was aborted\.?$/i.test(trimmed) ||
    /operation was aborted/i.test(trimmed)
  );
}

function isAbortRelatedResult(result = {}) {
  return (
    !!result.aborted ||
    result.type === "aborted" ||
    (result.type === "error" && isAbortRelatedText(result.text))
  );
}

function isManualAbortDividerMessage(message = {}) {
  return (
    message?.dividerType === "manual-abort" ||
    message?.dividerType === "abort"
  );
}

function markPreviousAssistantManualAborted(messages = [], fromIndex = -1) {
  const list = Array.isArray(messages) ? [...messages] : [];
  const start = fromIndex < 0 ? list.length + fromIndex : fromIndex;
  for (let i = start; i >= 0; i--) {
    const prev = list[i];
    if (
      !prev ||
      prev.role === "you" ||
      prev.role === "divider" ||
      prev.role === "system"
    ) {
      continue;
    }
    list[i] = { ...prev, manualAborted: true, isComplete: true };
    break;
  }
  return list;
}

function stripAbortTextSegments(segments = []) {
  return (Array.isArray(segments) ? segments : []).filter(
    (seg) => !(seg?.type === "text" && isAbortRelatedText(seg.text || "")),
  );
}

function sanitizeManualAbortMessages(messages = []) {
  const list = Array.isArray(messages) ? messages : [];
  const result = [];
  for (const message of list) {
    if (isManualAbortDividerMessage(message)) {
      const folded = markPreviousAssistantManualAborted(result);
      result.length = 0;
      result.push(...folded);
      continue;
    }
    const text = String(message?.text || message?.content || "").trim();
    if (message?.role === "error" && isAbortRelatedText(text)) {
      const folded = markPreviousAssistantManualAborted(result);
      result.length = 0;
      result.push(...folded);
      continue;
    }
    result.push(message);
  }
  return result.map((message) => {
    const segments = stripAbortTextSegments(message.segments || []);
    const plainText = String(message?.text || "").trim();
    const hadAbortText =
      message?.manualAborted ||
      isAbortRelatedText(plainText) ||
      (Array.isArray(message.segments) &&
        message.segments.some(
          (seg) => seg?.type === "text" && isAbortRelatedText(seg.text || ""),
        ));
    if (!hadAbortText) return message;
    const next = {
      ...message,
      manualAborted: true,
      isComplete: true,
      segments,
    };
    if (isAbortRelatedText(plainText)) {
      delete next.text;
    }
    return next;
  });
}

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
  if (path === "/sessions") return { view: "sessions" };
  if (path === "/codewiki")
    return { view: "codewiki", projectPath: params.get("project") || "" };
  return { view: "chat" };
}

function routeFor(view, sessionId, options = {}) {
  if (view === "sessions") return "/sessions";
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
  const dir = rs.cwd || rs.projectDir || "";
  return dir.split(/[/\\]/).pop() || dir || "...";
}

const initialState = {
  stage: "idle",
  busy: false,
  currentView: "chat",
  runtimeState: null,
  currentSessionId: null,
  sessionRuntimeById: {},
  sessionMessagesById: {},
  live: false,
  stageLabel: "",
  messages: [],
  activeMsgId: null,
  pendingToolChanges: [],
  planSteps: [],
  pendingSpecApproval: null,
  pendingReflectApproval: null,
  runtimeActivities: [],
  approvalRequest: null,
  userInputRequest: null,
  config: null,
  configStatus: null,
  configOpen: false,
  projectOpen: false,
  skillsOpen: false,
  memoryOpen: false,
  soulsOpen: false,
  soulsRevision: 0,
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

function isCompletedStatus(status) {
  return ["done", "failed", "error", "blocked", "completed"].includes(
    String(status || "").toLowerCase(),
  );
}

function hasCompletedPlanOverview(messages) {
  return (Array.isArray(messages) ? messages : []).some((message) => {
    const steps = message?.planOverview?.steps;
    return (
      message?.role === "plan-overview" &&
      Array.isArray(steps) &&
      steps.length > 0 &&
      steps.every((step) => isCompletedStatus(step.status))
    );
  });
}

function settleCompletedPlanToolCards(messages) {
  if (!hasCompletedPlanOverview(messages)) return messages;
  return (Array.isArray(messages) ? messages : []).map((message) => ({
    ...message,
    segments: (Array.isArray(message.segments) ? message.segments : []).map(
      (seg) => {
        if (seg?.type !== "tools" || !Array.isArray(seg.cards)) return seg;
        return {
          ...seg,
          cards: seg.cards.map((card) =>
            card?.name === "create_plan" && card.status === "running"
              ? { ...card, status: "done" }
              : card,
          ),
        };
      },
    ),
  }));
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
    value.includes("Plan created for engineering-mode execution") ||
    value.includes("Plan created and waiting for approval") ||
    value.includes("Pending plan approval") ||
    value.includes("Pending plan approval")
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

function getSpecDisplayTitle(spec = {}) {
  return (
    String(spec.summary || "").trim() ||
    String(spec.goal || "")
      .trim()
      .split(/\r?\n/)[0] ||
    "spec"
  );
}

function buildSpecExecuteDisplayText(spec = {}, mode = "direct") {
  const title = getSpecDisplayTitle(spec);
  const filePath = String(spec.filePath || "").trim();
  const actionLabel =
    mode === "plan" ? t("specPlanApproved") : t("specExecuteApproved");
  return [
    `${actionLabel}: ${title}`,
    filePath ? `${t("specPathLabel")}: ${filePath}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSpecExecuteDisplayMessage(spec = {}, mode = "direct") {
  const text = buildSpecExecuteDisplayText(spec, mode);
  return {
    text,
    specExecution: {
      title: getSpecDisplayTitle(spec),
      filePath: String(spec.filePath || "").trim(),
      mode,
    },
  };
}

function createPlanStepMessage(event) {
  const id =
    String(event.messageId || "").trim() ||
    `plan-step-${event.step}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
      model: event.model || "",
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

function hasVisiblePlanStepOutput(message) {
  return (Array.isArray(message?.segments) ? message.segments : []).some(
    (segment) =>
      (segment?.type === "text" || segment?.type === "handoff") &&
      String(segment.text || "").trim(),
  );
}

function enrichPlanRunMessagesFromSection(runMessages, sectionMessages) {
  const sourcesByStep = new Map(
    (Array.isArray(sectionMessages) ? sectionMessages : [])
      .filter((message) => message?.planStep?.step != null)
      .map((message) => [String(message.planStep.step), message]),
  );
  if (!sourcesByStep.size) return runMessages;
  return (Array.isArray(runMessages) ? runMessages : []).map((message) => {
    const step = message?.planStep?.step;
    if (step == null) return message;
    const source = sourcesByStep.get(String(step));
    if (!source) return message;
    const messageFiles = Array.isArray(message.fileChanges)
      ? message.fileChanges
      : [];
    const sourceFiles = Array.isArray(source.fileChanges)
      ? source.fileChanges
      : [];
    return {
      ...message,
      segments: hasVisiblePlanStepOutput(message)
        ? message.segments
        : Array.isArray(source.segments)
          ? source.segments
          : message.segments,
      fileChanges: sourceFiles.length ? sourceFiles : messageFiles,
      usage: source.usage || message.usage || null,
      planStep: {
        ...(message.planStep || {}),
        ...(source.planStep || {}),
        status: source.planStep?.status || message.planStep?.status || "done",
        summary: source.planStep?.summary || message.planStep?.summary || "",
      },
    };
  });
}

function messagePlainText(message) {
  const direct = String(message?.text || message?.content || "").trim();
  if (direct) return direct;
  return (Array.isArray(message?.segments) ? message.segments : [])
    .filter(
      (segment) => segment?.type === "text" || segment?.type === "handoff",
    )
    .map((segment) => String(segment.text || ""))
    .join("")
    .trim();
}

function skillBadgeKey(badge = {}) {
  return `${String(badge.status || "done")}::${String(badge.name || "").trim()}`;
}

function appendUniqueSkillBadges(current = [], next = []) {
  const out = Array.isArray(current) ? [...current] : [];
  const seen = new Set(out.map(skillBadgeKey));
  for (const badge of Array.isArray(next) ? next : []) {
    const key = skillBadgeKey(badge);
    if (!String(badge?.name || "").trim() || seen.has(key)) continue;
    seen.add(key);
    out.push(badge);
  }
  return out;
}

function isStructuredPlanUiMessage(message) {
  return message?.role === "plan-overview" || !!message?.planStep;
}

function isEmptyPlanRunPlaceholderMessage(message) {
  if (!message || message.planStep || message.planOverview) return false;
  const role = String(message.role || "").toLowerCase();
  if (!["general", "agent", "coder", "pending"].includes(role)) return false;
  if (String(message.text || "").trim()) return false;
  if (Array.isArray(message.segments) && message.segments.length > 0)
    return false;
  if (Array.isArray(message.skillBadges) && message.skillBadges.length > 0)
    return false;
  return true;
}

function withoutEmptyPlanRunPlaceholder(messages, activeId) {
  if (!activeId) return messages;
  return (Array.isArray(messages) ? messages : []).filter(
    (message) =>
      message.id !== activeId || !isEmptyPlanRunPlaceholderMessage(message),
  );
}

function getAbortedPlanStepIndexes(messages) {
  return new Set(
    (Array.isArray(messages) ? messages : [])
      .filter(
        (message) =>
          message.isComplete === false && message.planStep?.step != null,
      )
      .map((message) => Number(message.planStep.step) - 1),
  );
}

function collectUiPlanRuns(uiMessages = []) {
  const runs = [];
  let current = null;
  let lastUserText = "";
  for (const message of Array.isArray(uiMessages) ? uiMessages : []) {
    if (message?.role === "you") {
      lastUserText = messagePlainText(message);
      if (current) {
        runs.push(current);
        current = null;
      }
      continue;
    }
    if (message?.role === "plan-overview") {
      if (current) runs.push(current);
      current = { anchorText: lastUserText, messages: [message] };
      continue;
    }
    if (message?.planStep) {
      if (!current) current = { anchorText: lastUserText, messages: [] };
      current.messages.push(message);
      continue;
    }
    if (current) {
      runs.push(current);
      current = null;
    }
  }
  if (current) runs.push(current);
  return runs.filter((run) => run.messages.some(isStructuredPlanUiMessage));
}

function mergeStructuredUiPlans(processedMessages, uiMessages) {
  const runs = collectUiPlanRuns(uiMessages);
  if (!runs.length) return processedMessages;
  let merged = [...processedMessages];
  let searchFrom = 0;
  for (const run of runs) {
    const anchor = String(run.anchorText || "").trim();
    let userIndex = -1;
    if (anchor) {
      userIndex = merged.findIndex((message, index) => {
        if (index < searchFrom || message.role !== "you") return false;
        const text = messagePlainText(message);
        return (
          text === anchor || text.includes(anchor) || anchor.includes(text)
        );
      });
    }
    if (userIndex === -1) {
      userIndex = merged.findIndex(
        (message, index) => index >= searchFrom && message.role === "you",
      );
    }
    if (userIndex === -1) {
      merged = [...merged, ...run.messages];
      searchFrom = merged.length;
      continue;
    }

    const nextUserIndex = merged.findIndex(
      (message, index) => index > userIndex && message.role === "you",
    );
    const sectionEnd = nextUserIndex === -1 ? merged.length : nextUserIndex;
    const section = merged.slice(userIndex + 1, sectionEnd);
    const firstExistingPlanIndex = section.findIndex(isStructuredPlanUiMessage);
    const insertAt =
      firstExistingPlanIndex === -1
        ? sectionEnd
        : userIndex + 1 + firstExistingPlanIndex;
    const planMessages = enrichPlanRunMessagesFromSection(
      run.messages,
      section,
    );
    const before = merged.slice(0, userIndex + 1);
    const afterUserSection = merged
      .slice(userIndex + 1, sectionEnd)
      .filter((message) => !isStructuredPlanUiMessage(message));
    const nextSection = merged.slice(sectionEnd);
    const relativeInsert = Math.max(0, insertAt - (userIndex + 1));
    const rebuiltSection = [
      ...afterUserSection.slice(0, relativeInsert),
      ...planMessages,
      ...afterUserSection.slice(relativeInsert),
    ];
    merged = [...before, ...rebuiltSection, ...nextSection];
    searchFrom = userIndex + rebuiltSection.length + 1;
  }
  return merged;
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
  const [state, rawSetState] = useState(initialState);
  const setState = useCallback((updater) => {
    rawSetState((previous) => {
      const next =
        typeof updater === "function" ? updater(previous) : updater;
      if (
        next &&
        next.currentSessionId === previous.currentSessionId &&
        next.currentSessionId &&
        next.messages !== previous.messages
      ) {
        return {
          ...next,
          sessionMessagesById: {
            ...next.sessionMessagesById,
            [next.currentSessionId]: next.messages,
          },
        };
      }
      return next;
    });
  }, []);
  const stateRef = useRef(state);
  stateRef.current = state;

  const activeMsgRef = useRef(null);
  const pendingChangesRef = useRef([]);
  const sessionsLoadPromiseRef = useRef(null);
  const pendingSkillBadgesRef = useRef([]);
  const pendingSkillSegmentsRef = useRef([]);
  const planRunPendingRef = useRef(false);
  const aggressivePruneSavedRef = useRef(0);
  const planStepMessagesRef = useRef(new Map());
  const planOverviewMsgRef = useRef(null);
  const activityTimersRef = useRef(new Map());
  const sseRef = useRef(null);
  const reconnectRef = useRef(null);
  const operationWaitersRef = useRef(new Map());
  const earlyOperationResultsRef = useRef(new Map());
  const sessionOperationsRef = useRef(new Set());

  const activateSessionView = useCallback((sessionId) => {
    activeMsgRef.current = null;
    pendingChangesRef.current = [];
    pendingSkillBadgesRef.current = [];
    pendingSkillSegmentsRef.current = [];
    planStepMessagesRef.current = new Map();
    planOverviewMsgRef.current = null;
    setState((prev) => activateSession(prev, sessionId));
  }, [setState]);

  const update = useCallback((updates) => {
    setState((prev) => ({ ...prev, ...updates }));
  }, []);

  const addMessage = useCallback((msg) => {
    const id =
      msg.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const segments =
      Array.isArray(msg.segments) && msg.segments.length > 0
        ? [...msg.segments]
        : msg.text
          ? [
              {
                type: "text",
                text: msg.text,
                isStreaming: msg.isStreaming || false,
              },
            ]
          : [];
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

  const loadState = useCallback(async (sessionId, { isAlive = () => true } = {}) => {
    try {
      const [rs, cfg] = await Promise.all([
        api.fetchState(sessionId || stateRef.current.currentSessionId),
        api.fetchConfig().catch(() => null),
      ]);
      if (!isAlive()) return null;
      const reasoningPatch = cfg ? extractReasoningRuntimePatch(cfg) : {};
      const busy = !!rs.busy;
      const codeWikiGenerating = !!rs.codeWikiGenerating;
      setState((prev) => ({
        ...prev,
        runtimeState: { ...prev.runtimeState, ...rs, ...reasoningPatch },
        currentSessionId: rs.sessionId || sessionId || prev.currentSessionId,
        sessionRuntimeById: {
          ...prev.sessionRuntimeById,
          [rs.sessionId || sessionId]: {
            ...prev.sessionRuntimeById[rs.sessionId || sessionId],
            ...rs,
            ...reasoningPatch,
          },
        },
        projectCwd: projectNameFromRuntimeState(rs),
        isGeneral: !!rs.isGeneral,
        pendingSpecApproval: rs?.pendingSpecApproval || null,
        pendingReflectApproval: rs?.pendingReflectSkill || null,
        userInputRequest: rs?.pendingUserInput || null,
        busy,
        live: busy || prev.live,
        stage: busy ? "thinking" : prev.stage,
        stageLabel: busy ? t("waitingResponse") : prev.stageLabel,
        codewikiGeneration: codeWikiGenerating
          ? {
              status: "running",
              updatedAt: new Date().toISOString(),
              error: "",
            }
          : prev.codewikiGeneration,
        messages: removeTransientMessages(prev.messages, "plan-waiting-review"),
      }));
      return { ...rs, ...reasoningPatch };
    } catch {
      return null;
    }
  }, [update]);

  const loadRuntimeSessions = useCallback(async ({ isAlive = () => true } = {}) => {
    try {
      const result = await api.fetchRuntimeSessions();
      if (!isAlive()) return null;
      setState((prev) => hydrateSessionRuntimes(prev, result?.sessions));
      return result?.sessions || {};
    } catch {
      return null;
    }
  }, []);

  const loadConfigStatus = useCallback(
    async ({ openIfRequired = false, isAlive = () => true } = {}) => {
      try {
        const configStatus = await api.fetchConfigStatus();
        if (!isAlive()) return null;
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

  const gitInfoRequestRef = useRef(0);

  const loadGitInfo = useCallback(async ({ isAlive = () => true, sessionId } = {}) => {
    const targetSessionId = sessionId || stateRef.current.currentSessionId || null;
    const requestId = ++gitInfoRequestRef.current;
    if (isAlive()) update({ gitInfo: null });
    try {
      const info = await api.fetchGitInfo(targetSessionId);
      if (!isAlive() || requestId !== gitInfoRequestRef.current) return;
      if (
        targetSessionId &&
        stateRef.current.currentSessionId &&
        targetSessionId !== stateRef.current.currentSessionId
      ) {
        return;
      }
      update({ gitInfo: info });
    } catch {
      if (!isAlive() || requestId !== gitInfoRequestRef.current) return;
      update({
        gitInfo: {
          isGit: false,
          branch: null,
          dirty: false,
          staged: 0,
          modified: 0,
          untracked: 0,
          linesAdded: 0,
          linesRemoved: 0,
        },
      });
    }
  }, [update]);

  const loadGitBatch = useCallback(
    async (sessions, { isAlive = () => true } = {}) => {
      const dirs = [
        ...new Set((sessions || []).map((s) => s.projectDir).filter(Boolean)),
      ];
      if (!dirs.length) return;
      try {
        const batch = await api.fetchGitBatch(dirs);
        if (isAlive()) update({ gitBatch: batch });
      } catch {}
    },
    [update],
  );

  const loadHistory = useCallback(async ({ isAlive = () => true, sessionId } = {}) => {
    try {
      const history = await api.fetchHistory(
        sessionId || stateRef.current.currentSessionId,
      );
      if (isAlive()) update({ history: Array.isArray(history) ? history : [] });
    } catch {}
  }, [update]);

  const loadSessions = useCallback(
    async (options = {}) => {
      const force = options?.force === true;
      const isAlive = options?.isAlive || (() => true);
      if (force) sessionsLoadPromiseRef.current = null;
      if (sessionsLoadPromiseRef.current) return sessionsLoadPromiseRef.current;
      if (isAlive()) update({ sessionsLoading: true });
      const promise = (async () => {
        try {
          const sessions = await api.fetchSessions(200);
          if (!isAlive()) return;
          const list = Array.isArray(sessions) ? sessions : [];
          update({ sessions: list });
          loadGitBatch(list, { isAlive });
        } catch {
        } finally {
          if (isAlive()) update({ sessionsLoading: false });
          sessionsLoadPromiseRef.current = null;
        }
      })();
      sessionsLoadPromiseRef.current = promise;
      return promise;
    },
    [update, loadGitBatch],
  );

  const openCodeWikiProjectFromRoute = useCallback(async (projectPath) => {
    if (!projectPath) return null;
    try {
      const currentState = await api.fetchState(stateRef.current.currentSessionId);
      if (currentState?.cwd === projectPath) return currentState;
      const result = await api.openProject(projectPath);
      if (result?.error) return null;
      return result;
    } catch {
      return null;
    }
  }, []);

  const loadSkills = useCallback(async ({ isAlive = () => true } = {}) => {
    try {
      const skills = await api.fetchSkills();
      if (isAlive()) update({ skills: Array.isArray(skills) ? skills : [] });
    } catch {}
  }, [update]);

  // Restore the active-message ref to the last incomplete assistant/plan
  // message so that SSE deltas arriving after a session switch continue
  // the existing bubble instead of creating a new one.
  //
  // When the session is still active (busy status) we also fall back to
  // the last assistant message even when it looks "complete" — agentic
  // loops pause between model calls (isComplete=true, no streaming, no
  // running tools) and the next assistant:start must land on the same
  // bubble.
  function restoreActiveMsgRef(messages, sessionActive = false) {
    const list = Array.isArray(messages) ? messages : [];
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (
        m.role === "you" ||
        m.role === "divider" ||
        m.role === "system" ||
        m.transientKey
      )
        continue;
      if (m.isComplete === false) {
        activeMsgRef.current = m.id;
        return;
      }
      if (
        (m.segments || []).some(
          (seg) =>
            seg.isStreaming ||
            (seg.type === "tools" &&
              (seg.cards || []).some((c) => c.status === "running")),
        )
      ) {
        activeMsgRef.current = m.id;
        return;
      }
      if (
        m.planStep &&
        !["done", "failed"].includes(String(m.planStep.status || ""))
      ) {
        activeMsgRef.current = m.id;
        return;
      }
      // Fallback for active sessions: use the last assistant message
      // even if it appears complete (between model calls).
      if (sessionActive && !activeMsgRef.current) {
        activeMsgRef.current = m.id;
        return;
      }
    }
  }

  const loadSessionMessages = useCallback(
    async (
      sessionData = null,
      {
        isAlive = () => true,
        sessionId,
        reconcileCached = false,
      } = {},
    ) => {
      const ownerSessionId = sessionId || stateRef.current.currentSessionId;
      if (isAlive()) update({ messagesLoading: true });
      try {
        const data = sessionData || (await api.fetchSessionMessages(ownerSessionId));
        if (!isAlive()) return;
        const messages = Array.isArray(data) ? data : data.messages || [];
        const compactMeta = data?.compact || null;
        const restoredActivities =
          restoreRuntimeActivitiesFromMessages(messages);

        const uiData = sessionData
          ? sessionData.uiMessages || { messages: [] }
          : await api.fetchSessionUiMessages(ownerSessionId).catch(() => []);
        if (!isAlive()) return;
        const uiMessages = Array.isArray(uiData)
          ? uiData
          : Array.isArray(uiData?.messages)
            ? uiData.messages
            : [];
        const commitMessages = (loadedMessages, runtimeActivities) => {
          const cachedMessages =
            stateRef.current.sessionMessagesById?.[ownerSessionId] || [];
          const previewMessages = reconcileCached
            ? reconcileSessionMessages(loadedMessages, cachedMessages)
            : loadedMessages;
          setState((prev) => {
            const latestCachedMessages =
              prev.sessionMessagesById?.[ownerSessionId] || [];
            const nextMessages = reconcileCached
              ? reconcileSessionMessages(
                  loadedMessages,
                  latestCachedMessages,
                )
              : loadedMessages;
            const isVisible = prev.currentSessionId === ownerSessionId;
            return {
              ...prev,
              ...(isVisible
                ? {
                    messages: nextMessages,
                    runtimeActivities,
                  }
                : {}),
              sessionMessagesById: {
                ...prev.sessionMessagesById,
                [ownerSessionId]: nextMessages,
              },
            };
          });
          if (stateRef.current.currentSessionId === ownerSessionId) {
            restoreActiveMsgRef(
              previewMessages,
              ACTIVE_SESSION_STATUSES.has(
                stateRef.current.sessionRuntimeById?.[ownerSessionId]?.status,
              ),
            );
          }
        };
        // Prefer the authoritative Web UI transcript when present.
        // Core session messages are only used as a legacy fallback.
        if (Array.isArray(uiMessages) && uiMessages.length) {
          const changeSets = sessionData
            ? []
            : (await api.fetchSessionChanges(ownerSessionId).catch(() => ({})))
                ?.changes || [];
          if (!isAlive()) return;
          const restored = sanitizeManualAbortMessages(
            settleCompletedPlanToolCards(uiMessages),
          );
          const overview = [...restored]
            .reverse()
            .find((m) => m.role === "plan-overview" && m.planOverview);
          planOverviewMsgRef.current = overview?.id || null;
          planStepMessagesRef.current = new Map(
            restored
              .filter((m) => m.planStep?.step != null)
              .map((m) => [String(m.planStep.step), m.id]),
          );
          commitMessages(
            enrichMessageChangeStates(restored, changeSets),
            restoredActivities,
          );
          return;
        }
        if (!messages.length) {
          commitMessages([], []);
          return;
        }
        // Legacy fallback: rebuild segments from core session messages.
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
              attachments: parseAttachmentsFromModelContent(msg.model_content),
              skillBadges: skillBadgesFromSessionMessage(msg),
              fileChanges: [],
            });
          } else if (msg.role === "assistant") {
            const responseStatus = String(
              msg.responseStatus || msg.response_status || "",
            ).toLowerCase();
            if (responseStatus === "error") {
              assistantGroup = null;
              if (isAbortRelatedText(msg.content || "")) {
                const folded = markPreviousAssistantManualAborted(processed);
                processed.length = 0;
                processed.push(...folded);
                continue;
              }
              processed.push({
                id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-e${processed.length}`,
                role: "error",
                text: msg.content || "",
                segments: [
                  {
                    type: "text",
                    text: msg.content || "",
                    isStreaming: false,
                  },
                ],
                skillBadges: [],
                fileChanges: [],
                timestamp: msg.at || new Date().toISOString(),
                responseStatus,
                retryPrompt: msg.retryPrompt || msg.retry_prompt || "",
                retryable:
                  responseStatus === "error" &&
                  Boolean(
                    String(msg.retryPrompt || msg.retry_prompt || "").trim(),
                  ),
              });
              continue;
            }

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
              const goal =
                msg.planGoal ||
                (lastUser
                  ? (lastUser.segments || [])
                      .filter((s) => s.type === "text")
                      .map((s) => s.text)
                      .join(" ") ||
                    lastUser.text ||
                    ""
                  : "");
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
              const goal =
                msg.planGoal ||
                (lastUser
                  ? (lastUser.segments || [])
                      .filter((s) => s.type === "text")
                      .map((s) => s.text)
                      .join(" ") ||
                    lastUser.text ||
                    ""
                  : "");
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
            if (msg.content && !isAbortRelatedText(msg.content))
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
          : (await api.fetchSessionChanges(ownerSessionId).catch(() => ({})))?.changes || [];
        if (!isAlive()) return;

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

        const restored = sanitizeManualAbortMessages(
          settleCompletedPlanToolCards(
            mergeAlignedAssistantSkillContext(
              alignSessionAssistantMessages(
                mergeAlignedUserContext(
                  alignSessionUserMessages(
                    mergeStructuredUiPlans(processed, uiMessages),
                    uiMessages,
                  ),
                  uiMessages,
                ),
                uiMessages,
              ),
              uiMessages,
            ),
          ),
        );
        const overview = [...restored]
          .reverse()
          .find((m) => m.role === "plan-overview" && m.planOverview);
        planOverviewMsgRef.current = overview?.id || null;
        planStepMessagesRef.current = new Map(
          restored
            .filter((m) => m.planStep?.step != null)
            .map((m) => [String(m.planStep.step), m.id]),
        );

        const enrichedMessages = enrichMessageChangeStates(restored, changeSets);
        commitMessages(enrichedMessages, restoredActivities);
      } catch {
      } finally {
        if (isAlive()) update({ messagesLoading: false });
      }
    },
    [update],
  );

  const handleEvent = useCallback(
    (event) => {
      if (!event?.type) return;
      if (isProjectIndexEvent(event)) return;
      const s = stateRef.current;
      if (event.type === "submit:done" && event.operationId) {
        const result = event.result || {};
        const key = operationKey(event.sessionId, event.operationId);
        const waiter = operationWaitersRef.current.get(key);
        if (waiter) {
          operationWaitersRef.current.delete(key);
          if (result.type === "error") {
            waiter.reject(new Error(result.text || t("actionFailed")));
          } else {
            waiter.resolve(result);
          }
        } else {
          earlyOperationResultsRef.current.set(key, result);
          setTimeout(() => {
            earlyOperationResultsRef.current.delete(key);
          }, 30000);
        }
      }
      if (event.sessionId) {
        setState((prev) => {
          const reduced = reduceSessionEvent(prev, event);
          // Keep raw messages aligned with the transcript cache so later
          // UI-only mutations do not wipe shared-reducer updates.
          if (
            event.sessionId === reduced.currentSessionId &&
            Array.isArray(reduced.sessionMessagesById?.[event.sessionId])
          ) {
            return {
              ...reduced,
              messages: reduced.sessionMessagesById[event.sessionId],
            };
          }
          return reduced;
        });
        if (event.sessionId !== s.currentSessionId) return;
      }
      const activeId = activeMsgRef.current;

      switch (event.type) {
        case "connected":
          break;

        case "assistant:start": {
          if (
            s.currentView !== "chat" &&
            s.currentView !== "codewiki" &&
            s.currentView !== "sessions"
          )
            update({ currentView: "chat" });
          setState((prev) => ({
            ...prev,
            messages: removeTransientMessages(
              prev.messages,
              "waiting-response",
            ),
          }));
          if (planRunPendingRef.current) {
            const serverId = String(event.messageId || "").trim();
            if (serverId) {
              const activePlanId = activeMsgRef.current;
              if (activePlanId && activePlanId !== serverId) {
                for (const [step, id] of [
                  ...planStepMessagesRef.current.entries(),
                ]) {
                  if (id === activePlanId) {
                    planStepMessagesRef.current.set(step, serverId);
                  }
                }
              }
              setActiveMsg(serverId);
            }
            update({
              stage: "thinking",
              busy: true,
              live: true,
              stageLabel: t("thinking"),
            });
            break;
          }
          const msgId = event.messageId || activeId;
          if (msgId) setActiveMsg(msgId);
          const pendingSkillBadges = pendingSkillBadgesRef.current;
          pendingSkillBadgesRef.current = [];
          const pendingSkillSegments = pendingSkillSegmentsRef.current;
          pendingSkillSegmentsRef.current = [];
          if (
            msgId &&
            (pendingSkillBadges.length || pendingSkillSegments.length)
          ) {
            setState((prev) => ({
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === msgId
                  ? {
                      ...m,
                      isComplete: false,
                      skillBadges: appendUniqueSkillBadges(
                        m.skillBadges || [],
                        pendingSkillBadges,
                      ),
                      segments: pendingSkillSegments.length
                        ? [
                            ...pendingSkillSegments,
                            ...(Array.isArray(m.segments) ? m.segments : []),
                          ]
                        : m.segments,
                    }
                  : m,
              ),
            }));
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
          update({
            stage: "streaming",
            live: true,
            stageLabel: t("streaming"),
          });
          break;
        }

        case "assistant:reasoning_delta": {
          update({ stage: "thinking", live: true, stageLabel: t("thinking") });
          break;
        }

        case "assistant:tool_call_delta":
        case "tool:start": {
          update({ stage: "tooling", live: true, stageLabel: t("tooling") });
          break;
        }

        case "assistant:response": {
          break;
        }

        case "tool:end": {
          const eventChanges =
            Array.isArray(event.fileChanges) && event.fileChanges.length
              ? event.fileChanges
              : event.fileChange
                ? [event.fileChange]
                : [];
          if (eventChanges.length) {
            pendingChangesRef.current = [
              ...pendingChangesRef.current,
              ...eventChanges,
            ];
          }
          break;
        }

        case "tool:result":
        case "tool:error":
        case "tool:blocked": {
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
          const placeholderId = activeId;
          setActiveMsg(null);
          const overviewMsg = createPlanOverviewMessage(event);
          planOverviewMsgRef.current = overviewMsg.id;
          setState((prev) => ({
            ...prev,
            planSteps: steps,
            messages: [
              ...withoutEmptyPlanRunPlaceholder(
                removeTransientMessages(prev.messages, "waiting-response"),
                placeholderId,
              ),
              overviewMsg,
            ],
          }));
          break;
        }

        case "plan:progress": {
          const { step, status, model: progressModel } = event;
          setState((prev) => ({
            ...prev,
            planSteps: prev.planSteps.map((s, i) =>
              i === step - 1
                ? {
                    ...s,
                    status,
                    ...(progressModel ? { model: progressModel } : {}),
                  }
                : s,
            ),
            messages: prev.messages.map((m) => {
              if (m.planStep?.step === step && progressModel) {
                return {
                  ...m,
                  planStep: {
                    ...(m.planStep || {}),
                    ...(status ? { status } : {}),
                    model: progressModel,
                  },
                };
              }
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
          const key = String(event.step);
          const sharedId = String(event.messageId || "").trim();
          let msgId = planStepMessagesRef.current.get(key);
          if (sharedId && msgId && msgId !== sharedId) {
            setState((prev) => ({
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === msgId ? { ...m, id: sharedId } : m,
              ),
            }));
            msgId = sharedId;
            planStepMessagesRef.current.set(key, msgId);
          }
          if (!msgId && sharedId) {
            const existing = stateRef.current.messages.find(
              (message) => message?.id === sharedId,
            );
            if (existing) {
              msgId = sharedId;
              planStepMessagesRef.current.set(key, msgId);
            }
          }
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
                    role: event.role || m.role || "general",
                    isComplete: false,
                    planStep: {
                      ...(m.planStep || {}),
                      step: event.step,
                      total: event.total ?? m.planStep?.total,
                      role: event.role || m.planStep?.role || "general",
                      title: event.title || m.planStep?.title || "",
                      status: "running",
                      ...(event.model ? { model: event.model } : {}),
                    },
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
          const stepKey = String(event.step);
          let msgId = planStepMessagesRef.current.get(stepKey);
          if (!msgId) {
            const match = stateRef.current.messages.find(
              (message) => Number(message?.planStep?.step) === Number(event.step),
            );
            if (match?.id) {
              msgId = match.id;
              planStepMessagesRef.current.set(stepKey, msgId);
            }
          }
          if (msgId) {
            setState((prev) => ({
              ...prev,
              messages: prev.messages.map((m) => {
                const isTarget =
                  m.id === msgId ||
                  Number(m.planStep?.step) === Number(event.step);
                if (isTarget) {
                  const outputText = String(event.output || "").trim();
                  const finishedSegments = finishThinkingSegments(
                    m.segments,
                  ).map((seg) =>
                    seg.type === "text" ? { ...seg, isStreaming: false } : seg,
                  );
                  const hasOutputText =
                    outputText &&
                    finishedSegments.some(
                      (seg) =>
                        (seg.type === "text" || seg.type === "handoff") &&
                        String(seg.text || "").trim() === outputText,
                    );
                  return {
                    ...m,
                    id: msgId,
                    role: event.role || m.role || m.planStep?.role || "general",
                    usage: mergeUsage(m.usage, event.usage),
                    segments:
                      outputText && !hasOutputText
                        ? [
                            ...finishedSegments,
                            {
                              type:
                                String(
                                  event.role || m.planStep?.role || "",
                                ).toLowerCase() === "summarizer"
                                  ? "text"
                                  : "handoff",
                              text: outputText,
                              isStreaming: false,
                            },
                          ]
                        : finishedSegments,
                    isComplete: true,
                    planStep: {
                      ...(m.planStep || {}),
                      step: event.step,
                      total: event.total ?? m.planStep?.total,
                      role: event.role || m.planStep?.role || "general",
                      title: event.title || m.planStep?.title || "",
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
          if (!activeId) {
            pendingSkillSegmentsRef.current = addSkillToSegments(
              pendingSkillSegmentsRef.current,
              event,
            );
          }
          break;
        }
        case "skill:end": {
          if (!activeId) {
            pendingSkillSegmentsRef.current = updateSkillInSegments(
              pendingSkillSegmentsRef.current,
              event.name,
              (segment) => ({
                ...segment,
                status: "done",
                endedAt: event.endedAt || new Date().toISOString(),
              }),
            );
          }
          break;
        }
        case "skill:error": {
          if (!activeId) {
            pendingSkillSegmentsRef.current = updateSkillInSegments(
              pendingSkillSegmentsRef.current,
              event.name,
              (segment) => ({
                ...segment,
                status: "error",
                summary: event.summary,
                endedAt: event.endedAt || new Date().toISOString(),
              }),
            );
          }
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
            pendingSkillBadgesRef.current = appendUniqueSkillBadges(
              pendingSkillBadgesRef.current,
              [badge],
            );
          } else {
            setState((prev) => ({
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === activeId
                  ? {
                      ...m,
                      skillBadges: appendUniqueSkillBadges(
                        m.skillBadges || [],
                        [badge],
                      ),
                    }
                  : m,
              ),
            }));
          }
          // Also attach to the last user message so the badge appears on
          // the user's own bubble alongside the assistant response.
          setState((prev) => {
            let lastUserIdx = -1;
            for (let i = prev.messages.length - 1; i >= 0; i--) {
              if (prev.messages[i].role === "you") { lastUserIdx = i; break; }
            }
            if (lastUserIdx === -1) return prev;
            return {
              ...prev,
              messages: prev.messages.map((m, i) =>
                i === lastUserIdx
                  ? {
                      ...m,
                      skillBadges: appendUniqueSkillBadges(
                        m.skillBadges || [],
                        [badge],
                      ),
                    }
                  : m,
              ),
            };
          });
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

        case "compact:aggressive-prune": {
          // Beta aggressive prune runs proactively each step; accumulate tokens
          // saved across the entire session so the activity reflects cumulative
          // savings rather than a single prune.
          const saved = Number(event.tokensSaved) || 0;
          aggressivePruneSavedRef.current += saved;
          upsertRuntimeActivity({
            key: "aggressive-prune",
            status: "done",
            emoji: "✂️",
            label: t("runtimeActivityAggressivePrune"),
            detail: `-${aggressivePruneSavedRef.current} tokens (session)`,
          });
          break;
        }

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
              ...(() => {
                const activeMessage = prev.messages.find(
                  (m) => m.id === activeId,
                );
                const activePlanStep = activeMessage?.planStep;
                const activeStepNumber = Number(activePlanStep?.step);
                const shouldSettlePlanStep =
                  activePlanStep &&
                  Number.isFinite(activeStepNumber) &&
                  !isCompletedStatus(activePlanStep.status);
                const settledStatus =
                  result.type === "error" ? "failed" : "done";
                return {
                  planSteps: shouldSettlePlanStep
                    ? prev.planSteps.map((step, index) =>
                        index === activeStepNumber - 1 &&
                        !isCompletedStatus(step.status)
                          ? { ...step, status: settledStatus }
                          : step,
                      )
                    : prev.planSteps,
                  messages: prev.messages.map((m) => {
                    if (
                      shouldSettlePlanStep &&
                      m.id === planOverviewMsgRef.current &&
                      m.planOverview
                    ) {
                      return {
                        ...m,
                        planOverview: {
                          ...m.planOverview,
                          steps: m.planOverview.steps.map((step, index) =>
                            index === activeStepNumber - 1 &&
                            !isCompletedStatus(step.status)
                              ? { ...step, status: settledStatus }
                              : step,
                          ),
                        },
                      };
                    }
                    if (m.id !== activeId) return m;
                    const segments = finishThinkingSegments(
                      m.segments || [],
                    ).map((seg) =>
                      seg.type === "text"
                        ? { ...seg, isStreaming: false }
                        : seg,
                    );
                    return {
                      ...m,
                      isComplete: true,
                      segments,
                      ...(isAbortRelatedResult(result)
                        ? { responseStatus: "aborted" }
                        : {}),
                      planStep: shouldSettlePlanStep
                        ? {
                            ...(m.planStep || {}),
                            status: settledStatus,
                            summary:
                              m.planStep?.summary ||
                              (settledStatus === "failed" ? "Failed" : ""),
                          }
                        : m.planStep,
                    };
                  }),
                };
              })(),
            }));
          }
          if (result.type === "system" && result.text) {
            const activity = getRuntimeActivityFromSystemText(result.text);
            if (activity) upsertRuntimeActivity(activity);
            if (/^Plan revised\./i.test(result.text)) {
              addMessage({
                role: "agent",
                text: t("planReviewRevisedAssistant"),
                timestamp: new Date().toISOString(),
              });
            } else if (
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
          if (
            result.type === "error" &&
            result.text &&
            !isAbortRelatedResult(result)
          ) {
            addMessage({
              role: "error",
              text: `Failed: ${result.text}`,
              timestamp: new Date().toISOString(),
              responseStatus: "error",
              retryPrompt: result.retryPrompt || "",
              retryable: Boolean(String(result.retryPrompt || "").trim()),
            });
          }
          if (isAbortRelatedResult(result) && result.text && !activeId) {
            setState((prev) => ({
              ...prev,
              messages: markPreviousAssistantManualAborted(prev.messages),
            }));
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
              stateRef.current.pendingSpecApproval
                ? "waiting-response"
                : ["waiting-response", "plan-waiting-review"],
            ),
          }));
          loadHistory();
          loadSessions({ force: true });
          loadGitInfo({
            sessionId: stateRef.current.currentSessionId,
          });
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
          const runtimeState = { ...stateRef.current.runtimeState, ...rs };
          if (rs.reasoningEffort == null) {
            runtimeState.reasoningEffort =
              stateRef.current.runtimeState?.reasoningEffort;
          }
          if (rs.reasoningEnabled == null) {
            runtimeState.reasoningEnabled =
              stateRef.current.runtimeState?.reasoningEnabled;
          }
          update({
            runtimeState,
            pendingSpecApproval: rs?.pendingSpecApproval || null,
            pendingReflectApproval: rs?.pendingReflectSkill || null,
            userInputRequest: rs?.pendingUserInput || null,
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
                ? String(event.status).toLowerCase() === "failed"
                  ? "error"
                  : "done"
                : "running",
              updatedAt: event.timestamp || new Date().toISOString(),
              error:
                terminalStatus &&
                String(event.status).toLowerCase() === "failed"
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

        case "session:title": {
          if (event.sessionId && event.title) {
            setState((prev) => {
              const rs = prev.runtimeState || {};
              const isGeneral = !!(prev.isGeneral || rs.isGeneral);
              const projectDir = isGeneral ? null : rs.cwd || rs.projectDir || null;
              const projectKey = projectDir || null;
              return {
                ...prev,
                sessions: upsertSidebarSession(prev.sessions, {
                  id: event.sessionId,
                  title: event.title,
                  messageCount: Math.max(
                    1,
                    Number(
                      prev.sessions.find((s) => s.id === event.sessionId)
                        ?.messageCount || 0,
                    ),
                  ),
                  isGeneral,
                  ...(projectDir ? { projectDir, projectKey } : {}),
                }),
              };
            });
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
      reconnectRef.current = setTimeout(() => {
        hydrateBeforeConnect({
          hydrate: loadRuntimeSessions,
          connect: connectSSE,
        }).catch(() => {});
      }, 3000);
    };
    sseRef.current = es;
  }, [handleEvent, loadRuntimeSessions]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const isAlive = () => alive;
      const route = parseRoute();
      const configStatusPromise = loadConfigStatus({
        openIfRequired: true,
        isAlive,
      });
      if (!alive) return;
      update({
        currentView: route.view,
        codewikiProjectPath:
          route.view === "codewiki"
            ? route.projectPath || ""
            : stateRef.current.codewikiProjectPath,
      });
      if (route.view === "codewiki" && route.projectPath) {
        await openCodeWikiProjectFromRoute(route.projectPath);
        if (!alive) return;
      }

      await configStatusPromise;
      if (!alive) return;

      const runtimeSessions = await loadRuntimeSessions({ isAlive });
      if (!alive) return;
      let preferredSessionId = route.sessionId || stateRef.current.currentSessionId;
      if (!preferredSessionId) {
        preferredSessionId = Object.keys(runtimeSessions || {})[0] || null;
      }
      let rs = preferredSessionId
        ? await loadState(preferredSessionId, { isAlive })
        : null;
      if (!alive) return;
      if (!rs) {
        const sessions = await api.fetchSessions(200).catch(() => []);
        if (!alive) return;
        preferredSessionId =
          Object.keys(runtimeSessions || {}).find((id) => id !== preferredSessionId) ||
          sessions?.[0]?.id ||
          null;
        update({ sessions, currentSessionId: preferredSessionId });
        rs = preferredSessionId
          ? await loadState(preferredSessionId, { isAlive })
          : null;
      }
      if (!alive) return;
      try {
        const startupEvents = rs?.sessionId
          ? await api.fetchStartupEvents(rs.sessionId)
          : [];
        if (!alive) return;
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
      if (route.view === "chat" && rs?.sessionId) {
        updateRoute("chat", rs.sessionId, { replace: true });
      } else if (route.view === "codewiki") {
        const projectPath = route.projectPath || rs?.cwd || "";
        update({ currentView: "codewiki", codewikiProjectPath: projectPath });
        if (projectPath)
          updateRoute("codewiki", null, { replace: true, projectPath });
      }
      await finishInitialization({
        tasks: [
        loadSessionMessages(null, { isAlive, sessionId: rs?.sessionId }),
        loadHistory({ isAlive, sessionId: rs?.sessionId }),
        loadSessions({ isAlive }),
        loadSkills({ isAlive }),
        loadGitInfo({ isAlive, sessionId: rs?.sessionId }),
        api
          .fetchVersion()
          .then((versionInfo) => {
            if (isAlive()) update({ versionInfo });
          })
          .catch(() => {}),
        ],
        isAlive,
        update,
        connect: connectSSE,
      });
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
          if (stateRef.current.currentSessionId !== route.sessionId) {
            update({ messagesLoading: true });
            activateSessionView(route.sessionId);
            await loadState(route.sessionId);
            await loadSessionMessages(null, { sessionId: route.sessionId });
            loadSessions();
            loadGitInfo({ sessionId: route.sessionId });
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
        loadGitInfo({ sessionId: rs?.sessionId });
      }
    };
    window.addEventListener("popstate", handlePopState);

    return () => {
      alive = false;
      if (sseRef.current) sseRef.current.close();
      clearTimeout(reconnectRef.current);
      for (const timer of activityTimersRef.current.values())
        clearTimeout(timer);
      activityTimersRef.current.clear();
      for (const waiter of operationWaitersRef.current.values())
        waiter.reject(new Error("Chat connection closed"));
      operationWaitersRef.current.clear();
      earlyOperationResultsRef.current.clear();
      window.removeEventListener("popstate", handlePopState);
    };
  }, [
    activateSessionView,
    addMessage,
    connectSSE,
    loadConfigStatus,
    loadGitInfo,
    loadHistory,
    loadSessionMessages,
    loadSessions,
    loadRuntimeSessions,
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
      submit: async (input, options = {}) => {
        const sessionId = stateRef.current.currentSessionId;
        return runSessionOperation(sessionOperationsRef.current, sessionId, async () => {
        const message = typeof input === "string"
          ? { text: input, skillNames: [], attachmentIds: [], dismissedAlwaysSkills: [] }
          : input || {};
        const line = String(message.text || "");
        if (!line.trim() && !(message.attachmentIds || []).length && !(message.skillNames || []).length) return;
        const selectedSkillBadges = [
          ...new Set(
            (Array.isArray(message.skillNames) ? message.skillNames : [])
              .map((name) => String(name || "").trim())
              .filter(Boolean),
          ),
        ].map((name) => ({ name, status: "selected" }));
        if (stateRef.current.currentView !== "chat" && !options.stayInView)
          update({ currentView: "chat" });
        const userMessageId = addMessage({
          role: "you",
          text: line,
          skillBadges: selectedSkillBadges,
          attachments: Array.isArray(options.attachments)
            ? options.attachments
            : Array.isArray(message.attachments)
              ? message.attachments
              : [],
          timestamp: new Date().toISOString(),
        });
        // Sidebar bubbles appear when the conversation starts, not when the
        // empty draft is created/reused.
        setState((prev) => {
          const existing = prev.sessions.find((s) => s.id === sessionId);
          if (existing && Number(existing.messageCount || 0) > 0) {
            return {
              ...prev,
              sessions: upsertSidebarSession(prev.sessions, {
                id: sessionId,
                updatedAt: new Date().toISOString(),
                messageCount: Number(existing.messageCount || 0) + 1,
              }),
            };
          }
          const rs = prev.runtimeState || {};
          const isGeneral = !!(prev.isGeneral || rs.isGeneral);
          const projectDir = isGeneral ? null : rs.cwd || rs.projectDir || null;
          const entry = buildConversationStartSidebarEntry({
            sessionId,
            text: line,
            isGeneral,
            projectDir,
            projectKey: projectDir,
          });
          if (!entry) return prev;
          return {
            ...prev,
            sessions: upsertSidebarSession(prev.sessions, entry),
          };
        });
        const waitingId = addMessage({
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
          const res = await api.submitMessage(sessionId, {
            text: line,
            messageId: userMessageId,
            skillNames: Array.isArray(message.skillNames) ? message.skillNames : [],
            attachmentIds: Array.isArray(message.attachmentIds)
              ? message.attachmentIds
              : [],
            dismissedAlwaysSkills: Array.isArray(message.dismissedAlwaysSkills)
              ? message.dismissedAlwaysSkills
              : [],
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
          await waitForAcceptedOperation(result, {
            sessionId,
            waiters: operationWaitersRef.current,
            earlyResults: earlyOperationResultsRef.current,
            fallbackError: t("actionFailed"),
          });
        } catch (err) {
          if (waitingId)
            setState((prev) => ({
              ...prev,
              messages: prev.messages.filter((m) => m.id !== waitingId),
            }));
          addMessage({
            role: "error",
            text: `Failed: ${err.message}`,
            timestamp: new Date().toISOString(),
            responseStatus: "error",
            retryPrompt: line,
            retryable: Boolean(line.trim()),
          });
          update({ busy: false, live: false });
          throw err;
        }
        });
      },

      runChatAction: async (actionName, payload = {}) => {
        const sessionId = stateRef.current.currentSessionId;
        return runSessionOperation(sessionOperationsRef.current, sessionId, async () => {
        update({
          busy: true,
          live: true,
          stage: "thinking",
          stageLabel: t("waitingResponse"),
        });
        try {
          const response = await api.submitChatAction(sessionId, actionName, payload);
          if (response?.error) throw new Error(response.message || t("actionFailed"));
          const accepted = response?.result;
          return await waitForAcceptedOperation(accepted, {
            sessionId,
            waiters: operationWaitersRef.current,
            earlyResults: earlyOperationResultsRef.current,
            fallbackError: t("actionFailed"),
          });
        } catch (err) {
          addMessage({
            role: "error",
            text: `Failed: ${err.message}`,
            timestamp: new Date().toISOString(),
          });
          update({ busy: false, live: false, stage: "idle", stageLabel: "" });
          throw err;
        }
        });
      },

      abort: async () => {
        try {
          await api.abortRequest(stateRef.current.currentSessionId);
        } catch {}
        planRunPendingRef.current = false;
        update({
          busy: false,
          live: false,
          stage: "idle",
          stageLabel: "",
        });
        setState((prev) => {
          const abortedSteps = getAbortedPlanStepIndexes(prev.messages);
          return {
            ...prev,
            planSteps: abortedSteps.size
              ? prev.planSteps.map((step, index) =>
                  abortedSteps.has(index) &&
                  !["done", "failed"].includes(String(step.status || ""))
                    ? { ...step, status: "failed" }
                    : step,
                )
              : prev.planSteps,
            messages: prev.messages.map((message) => {
              if (
                message.id === planOverviewMsgRef.current &&
                message.planOverview
              ) {
                if (!abortedSteps.size) return message;
                return {
                  ...message,
                  planOverview: {
                    ...message.planOverview,
                    steps: message.planOverview.steps.map((step, index) =>
                      abortedSteps.has(index) &&
                      !["done", "failed"].includes(String(step.status || ""))
                        ? { ...step, status: "failed" }
                        : step,
                    ),
                  },
                };
              }
              if (message.isComplete === false) {
                return {
                  ...message,
                  isComplete: true,
                  manualAborted: true,
                  segments: finishThinkingSegments(message.segments || []).map(
                    (seg) =>
                      seg.type === "text"
                        ? { ...seg, isStreaming: false }
                        : seg,
                  ),
                  planStep: message.planStep
                    ? {
                        ...message.planStep,
                        status: ["done", "failed"].includes(
                          String(message.planStep.status || ""),
                        )
                          ? message.planStep.status
                          : "failed",
                        summary: message.planStep.summary || "Aborted",
                      }
                    : message.planStep,
                };
              }
              return message;
            }),
          };
        });
      },

      abortSession: async (sessionId) => {
        if (!sessionId) return;
        await abortSessionIds([sessionId], api.abortRequest);
        setState((prev) => ({
          ...prev,
          sessionRuntimeById: {
            ...prev.sessionRuntimeById,
            [sessionId]: {
              ...prev.sessionRuntimeById[sessionId],
              sessionId,
              status: "interrupted",
              busy: false,
              needsAttention: false,
            },
          },
        }));
      },

      abortAllSessions: async () => {
        const sessionIds = activeSessionIds(
          stateRef.current.sessionRuntimeById,
        );
        const result = await abortSessionIds(
          sessionIds,
          api.abortRequest,
          { allowPartial: true },
        );
        setState((prev) => {
          const sessionRuntimeById = { ...prev.sessionRuntimeById };
          for (const sessionId of result.succeeded) {
            sessionRuntimeById[sessionId] = {
              ...sessionRuntimeById[sessionId],
              sessionId,
              status: "interrupted",
              busy: false,
              needsAttention: false,
            };
          }
          return { ...prev, sessionRuntimeById };
        });
        if (result.failed.length) {
          throw new AggregateError(
            result.failed.map((failure) => failure.reason),
            t("abortSessionsFailed").replace(
              "{{count}}",
              String(result.failed.length),
            ),
          );
        }
      },

      approve: async (id, actionName, ownerSessionId) => {
        const sessionId = ownerSessionId || stateRef.current.currentSessionId;
        try {
          const result = await api.submitChatAction(
            sessionId,
            actionName,
            { requestId: id },
          );
          if (result?.error) {
            if (result.code === "STALE_INTERACTION") return;
            throw new Error(result.message || "Request failed");
          }
        } catch (err) {
          addMessage({
            role: "error",
            text: `Failed: ${err.message}`,
            timestamp: new Date().toISOString(),
          });
        }
      },

      respondToUserInput: async (id, response, ownerSessionId) => {
        const effectiveSessionId = ownerSessionId || stateRef.current.currentSessionId;
        try {
          const result = await api.submitUserInput(
            effectiveSessionId,
            id,
            response,
          );
          if (result?.code === "STALE_INTERACTION") return;
          if (result?.error || result?.ok === false) {
            addMessage({
              role: "error",
              text: `Failed: ${result?.message || "Request failed"}`,
              timestamp: new Date().toISOString(),
            });
            await loadState();
          }
        } catch (err) {
          addMessage({
            role: "error",
            text: `Failed: ${err.message}`,
            timestamp: new Date().toISOString(),
          });
          await loadState();
        }
      },

      approveReflect: async (action, feedback) => {
        const draft = stateRef.current.pendingReflectApproval;
        if (!draft) return;
        upsertRuntimeActivity({
          key: "reflect",
          status: "running",
          emoji:
            action === CHAT_ACTION_NAMES.REFLECT_APPROVE ? "💾" : action === CHAT_ACTION_NAMES.REFLECT_REJECT ? "🗑️" : "📝",
          label:
            action === CHAT_ACTION_NAMES.REFLECT_APPROVE
              ? t("runtimeActivityReflectSaving")
              : action === CHAT_ACTION_NAMES.REFLECT_REJECT
                ? t("runtimeActivityReflectDiscarding")
                : t("runtimeActivityReflectRevising"),
          detail: draft.name ? `/${draft.name}` : "",
        });
        update({
          busy: true,
          live: true,
          stage: "thinking",
          stageLabel: t("waitingResponse"),
        });
        try {
          const actionName =
            action === CHAT_ACTION_NAMES.REFLECT_APPROVE
              ? CHAT_ACTION_NAMES.REFLECT_APPROVE
              : action === CHAT_ACTION_NAMES.REFLECT_REJECT
                ? CHAT_ACTION_NAMES.REFLECT_REJECT
                : feedback?.trim()
                  ? CHAT_ACTION_NAMES.REFLECT_REVISE
                  : null;
          if (!actionName) {
            update({ busy: false, live: false, stage: "idle", stageLabel: "" });
            return;
          }
          const result = await api.submitChatAction(stateRef.current.currentSessionId, actionName, {
            ...(feedback?.trim() ? { feedback: feedback.trim() } : {}),
          });
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
          const result = await api.updatePendingReflect(
            stateRef.current.currentSessionId,
            draft,
          );
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
        if (action === CHAT_ACTION_NAMES.SPEC_EXECUTE || action === CHAT_ACTION_NAMES.SPEC_PLAN_AND_EXECUTE) {
          const display = buildSpecExecuteDisplayMessage(
            spec,
            action === CHAT_ACTION_NAMES.SPEC_PLAN_AND_EXECUTE ? "plan" : "direct",
          );
          addMessage({
            role: "you",
            text: display.text,
            specExecution: display.specExecution,
            timestamp: new Date().toISOString(),
          });
        }
        update({
          busy: true,
          live: true,
          stage: "thinking",
          stageLabel: t("waitingResponse"),
        });
        try {
          if (action === LOCAL_SPEC_REVIEW_ACTIONS.DELETE) {
            const result = await api.deletePendingSpec(
              stateRef.current.currentSessionId,
            );
            if (result?.error)
              throw new Error(result.message || "Failed to delete spec");
            update({ busy: false, live: false, stage: "idle", stageLabel: "" });
            return;
          }
          if (action === CHAT_ACTION_NAMES.SPEC_PLAN_AND_EXECUTE) planRunPendingRef.current = true;
          const result = await api.submitChatAction(
            stateRef.current.currentSessionId,
            action,
          );
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

      updatePendingSpec: async (spec) => {
        try {
          const result = await api.updatePendingSpec(
            stateRef.current.currentSessionId,
            spec,
          );
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
          const result = await api.openSpecReview(
            stateRef.current.currentSessionId,
            spec.path,
          );
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
        const currentSessionId = stateRef.current.currentSessionId;
        if (!sessionId || sessionId === currentSessionId) return;
        aggressivePruneSavedRef.current = 0;
        update({ currentView: "chat", messagesLoading: true, gitInfo: null });
        try {
          const result = await api.switchSession(sessionId);
          if (result.ok) {
            const cachedTargetMessages =
              stateRef.current.sessionMessagesById?.[sessionId] || [];
            updateRoute("chat", sessionId);
            activateSessionView(sessionId);
            restoreActiveMsgRef(
              cachedTargetMessages,
              result.state?.busy === true ||
                ACTIVE_SESSION_STATUSES.has(
                  stateRef.current.sessionRuntimeById?.[sessionId]?.status,
                ),
            );

            if (result.state)
              setState((prev) => ({
                ...prev,
                runtimeState: result.state,
                sessionRuntimeById: {
                  ...prev.sessionRuntimeById,
                  [sessionId]: {
                    ...prev.sessionRuntimeById[sessionId],
                    ...result.state,
                  },
                },
                projectCwd: projectNameFromRuntimeState(result.state),
                isGeneral: !!result.state.isGeneral,
                live: !!result.state.busy,
                stageLabel: result.state.busy ? t("waitingResponse") : "",
              }));
            else {
              await loadState(sessionId);
              // loadState uses prev.live as fallback for idle sessions;
              // after a session switch, prev.live belongs to the old session,
              // so correct live/stageLabel from the new runtimeState.
              const rs = stateRef.current.runtimeState;
              update({
                live: !!rs?.busy,
                stageLabel: rs?.busy ? t("waitingResponse") : "",
              });
            }

            const msgPromise = loadSessionMessages(
              result.sessionData,
              { sessionId, reconcileCached: true },
            );
            loadSessions();
            loadGitInfo({ sessionId });
            await msgPromise;
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
            sessionRuntimeById: Object.fromEntries(
              Object.entries(prev.sessionRuntimeById).filter(
                ([id]) => id !== sessionId,
              ),
            ),
            sessionMessagesById: Object.fromEntries(
              Object.entries(prev.sessionMessagesById).filter(
                ([id]) => id !== sessionId,
              ),
            ),
          }));
          if (deletingCurrent) {
            update({ currentView: "chat", messagesLoading: true });
            const replacement = await api.newSession(
              stateRef.current.runtimeState?.cwd ||
                stateRef.current.runtimeState?.projectDir,
            );
            if (!replacement?.ok || !replacement.sessionId) {
              throw new Error(
                replacement?.message || "Failed to create replacement session",
              );
            }
            updateRoute("chat", replacement.sessionId, { replace: true });
            activateSessionView(replacement.sessionId);
            await Promise.all([
              loadState(replacement.sessionId),
              loadSessionMessages(null, { sessionId: replacement.sessionId }),
              loadGitInfo({ sessionId: replacement.sessionId }),
            ]);
            // Replacement session is always idle; reset live/stageLabel
            // since loadState may have kept prev.live from the deleted session.
            update({ live: false, stageLabel: "" });
          }
          loadSessions();
          return result;
        } catch (err) {
          return { error: true, message: err.message };
        }
      },

      newSession: async () => {
        aggressivePruneSavedRef.current = 0;
        update({ currentView: "chat", messagesLoading: true });
        try {
          const result = await api.newSession(
            stateRef.current.runtimeState?.cwd ||
              stateRef.current.runtimeState?.projectDir,
          );
          if (result.ok) {
            if (result.sessionId) {
              updateRoute("chat", result.sessionId);
              activateSessionView(result.sessionId);
              await loadState(result.sessionId);
              // A new session is always idle; reset live/stageLabel
              // since loadState falls back to prev.live from the old session.
              update({ live: false, stageLabel: "" });
            }
            // Empty drafts stay out of the sidebar until the first message.
            loadSessions({ force: true });
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
        const openingGeneral =
          projectPath === "__codemini_general__" ||
          String(projectPath || "").trim() === "";
        const pendingCodeWikiProjectPath =
          nextView === "codewiki"
            ? projectPath
            : stateRef.current.codewikiProjectPath;
        update({
          currentView: nextView,
          projectOpen: false,
          messagesLoading: nextView === "chat",
          codewikiProjectPath: pendingCodeWikiProjectPath,
          isGeneral: openingGeneral,
          gitInfo: null,
        });
        try {
          const result = await api.openProject(projectPath, {
            newSession: Boolean(options.newSession),
          });
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
            else if (result.sessionId) {
              updateRoute("chat", result.sessionId);
              activateSessionView(result.sessionId);
            }
            if (result.state) {
              setState((prev) => ({
                ...prev,
                runtimeState: result.state,
                sessionRuntimeById: {
                  ...prev.sessionRuntimeById,
                  [result.sessionId]: {
                    ...prev.sessionRuntimeById[result.sessionId],
                    ...result.state,
                  },
                },
                projectCwd: projectNameFromRuntimeState(result.state),
                isGeneral: !!result.state.isGeneral,
                live: !!result.state.busy,
                stageLabel: result.state.busy ? t("waitingResponse") : "",
              }));
            } else {
              await loadState(result.sessionId);
              // loadState falls back to prev.live for idle sessions;
              // after switching, prev.live belongs to the old session.
              const rs = stateRef.current.runtimeState;
              update({
                live: !!rs?.busy,
                stageLabel: rs?.busy ? t("waitingResponse") : "",
              });
            }
            const msgPromise =
              nextView === "chat" && result.sessionData
                ? loadSessionMessages(result.sessionData, {
                    sessionId: result.sessionId,
                  })
                : Promise.resolve();
            await Promise.all([
              loadSessions({ force: true }),
              loadGitInfo({ sessionId: result.sessionId }),
              msgPromise,
            ]);
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
        if (view === "sessions") updateRoute(view, null);
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
      refreshRuntimeState: () => loadState(),
      patchRuntimeReasoning: (config) => {
        const patch = extractReasoningRuntimePatch(config);
        update({
          runtimeState: {
            ...stateRef.current.runtimeState,
            ...patch,
          },
        });
      },
      setProjectOpen: (open) => update({ projectOpen: open }),
      setSkillsOpen: (open) => update({ skillsOpen: open }),
      setMemoryOpen: (open) => update({ memoryOpen: open }),
      setSoulsOpen: (open) => update({ soulsOpen: open }),
      notifySoulsChanged: () =>
        update({
          soulsRevision: (stateRef.current.soulsRevision || 0) + 1,
        }),
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
      activateSessionView,
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

  const projectedSessions = useMemo(
    () => projectSessionRuntime(state.sessions, state.sessionRuntimeById),
    [state.sessions, state.sessionRuntimeById],
  );
  const projectedState = useMemo(
    () =>
      projectVisibleSessionState({
        ...state,
        sessions: projectedSessions,
      }),
    [state, projectedSessions],
  );

  const value = useMemo(
    () => ({ state: projectedState, actions }),
    [projectedState, actions],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
