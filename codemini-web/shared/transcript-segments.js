import {
  updateToolInSegments,
  upsertSingletonToolCardInSegments,
  upsertToolCardInSegments,
} from "./tool-segments.js";
import { buildHookSegmentEvent } from "./hook-ui.js";
import { formatToolLabel as coreFormatToolLabel } from "../../src/core/tool-display.js";

const USAGE_KEYS = [
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "cachedInputTokens",
  "cacheMissInputTokens",
  "cacheWriteInputTokens",
  "reasoningOutputTokens",
  "requests",
];

export function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const out = {};
  for (const key of USAGE_KEYS) {
    const value = Number(usage?.[key]);
    if (Number.isFinite(value)) out[key] = Math.max(0, Math.round(value));
  }
  return Object.keys(out).length ? out : null;
}

export function mergeUsage(current, incoming) {
  const a = normalizeUsage(current);
  const b = normalizeUsage(incoming);
  if (!a) return b;
  if (!b) return a;
  const out = {};
  for (const key of USAGE_KEYS) {
    out[key] = Math.max(
      0,
      Math.round(Number(a[key] || 0) + Number(b[key] || 0)),
    );
  }
  return out;
}

export function createSkillSegment(event, status = "running") {
  const now = new Date().toISOString();
  const segment = {
    type: "skill",
    name: event.name,
    status,
    startedAt: event.startedAt || now,
    ...(status === "done" || status === "error"
      ? { endedAt: event.endedAt || now }
      : {}),
    ...(status === "error" && event.summary ? { summary: event.summary } : {}),
  };
  if (event.kind) segment.kind = event.kind;
  if (event.event) segment.event = event.event;
  if (event.source) segment.source = event.source;
  if (event.sourceLabel) segment.sourceLabel = event.sourceLabel;
  if (event.toolName) segment.toolName = event.toolName;
  if (event.matcher) segment.matcher = event.matcher;
  if (event.command) segment.command = event.command;
  if (event.summary && status !== "error") segment.summary = event.summary;
  if (event.reason) segment.reason = event.reason;
  return segment;
}

/** Insert PreToolUse before the tools segment that already shows that tool. */
function findPreToolUseInsertIndex(segments, toolName) {
  const name = String(toolName || "").trim();
  const list = Array.isArray(segments) ? segments : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const segment = list[index];
    if (segment?.type !== "tools" || !Array.isArray(segment.cards)) continue;
    if (!name) return index;
    if (segment.cards.some((card) => String(card?.name || "").trim() === name)) {
      return index;
    }
  }
  return -1;
}

export function addSkillToSegments(segments, event) {
  const source = Array.isArray(segments) ? segments : [];
  const existingIndex = source.findIndex(
    (segment) => segment?.type === "skill" && segment.name === event.name,
  );
  if (existingIndex !== -1) {
    return source.map((segment, index) =>
      index === existingIndex ? createSkillSegment(event) : segment,
    );
  }

  const nextSegment = createSkillSegment(event);
  // Tool cards appear during assistant:tool_call_delta, before PreToolUse runs.
  // Place PreToolUse above the matching tools group so the UI order matches lifecycle.
  if (event?.kind === "hook" && event?.event === "PreToolUse") {
    const insertAt = findPreToolUseInsertIndex(source, event.toolName);
    if (insertAt >= 0) {
      return [
        ...source.slice(0, insertAt),
        nextSegment,
        ...source.slice(insertAt),
      ];
    }
  }
  return [...source, nextSegment];
}

export function updateSkillInSegments(segments, name, updater) {
  const source = Array.isArray(segments) ? segments : [];
  let targetIndex = -1;
  for (let i = source.length - 1; i >= 0; i -= 1) {
    const segment = source[i];
    if (
      segment?.type === "skill" &&
      segment.name === name &&
      segment.status === "running"
    ) {
      targetIndex = i;
      break;
    }
  }
  if (targetIndex === -1) return source;
  return source.map((segment, index) =>
    index === targetIndex ? updater(segment) : segment,
  );
}

export function appendTextSegment(segments, delta, isStreaming = true) {
  const value = String(delta || "");
  if (!value) return Array.isArray(segments) ? segments : [];
  const current = Array.isArray(segments) ? segments : [];
  const now = new Date().toISOString();
  const insertAt = indexBeforeTrailingCreatePlan(current);
  const before = insertAt >= 0 ? current.slice(0, insertAt) : current;
  const after = insertAt >= 0 ? current.slice(insertAt) : [];
  const last = before[before.length - 1];
  if (last?.type === "text") {
    return [
      ...before.slice(0, -1),
      {
        ...last,
        text: `${last.text || ""}${value}`,
        isStreaming,
        startedAt: last.startedAt || now,
      },
      ...after,
    ];
  }
  return [
    ...before,
    { type: "text", text: value, isStreaming, startedAt: now },
    ...after,
  ];
}

export function replaceLastTextSegment(segments, text, isStreaming = false) {
  const value = String(text || "");
  const current = Array.isArray(segments) ? segments : [];
  // Walk backwards so tool cards after streamed text do not cause a duplicate
  // body when assistant:response finalizes the turn.
  for (let index = current.length - 1; index >= 0; index -= 1) {
    if (current[index]?.type !== "text") continue;
    return current.map((seg, i) =>
      i === index
        ? {
            ...seg,
            text: value,
            isStreaming,
            startedAt: seg.startedAt || new Date().toISOString(),
          }
        : seg,
    );
  }
  return value
    ? [
        ...current,
        {
          type: "text",
          text: value,
          isStreaming,
          startedAt: new Date().toISOString(),
        },
      ]
    : current;
}

export function appendThinkingSegment(segments, delta, isStreaming = true) {
  const value = String(delta || "");
  if (!value) return Array.isArray(segments) ? segments : [];
  const current = Array.isArray(segments) ? segments : [];
  const now = new Date().toISOString();
  const nowMs = Date.parse(now);
  const insertAt = indexBeforeTrailingCreatePlan(current);
  const before = insertAt >= 0 ? current.slice(0, insertAt) : current;
  const after = insertAt >= 0 ? current.slice(insertAt) : [];
  const last = before[before.length - 1];
  if (last?.type === "thinking") {
    const startedAt = last.startedAt || now;
    return [
      ...before.slice(0, -1),
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
      ...after,
    ];
  }
  return [
    ...before,
    {
      type: "thinking",
      text: value,
      isStreaming,
      startedAt: now,
      endedAt: isStreaming ? null : now,
      durationMs: isStreaming ? 0 : null,
    },
    ...after,
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

export function finishThinkingSegments(segments) {
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

export function finishStreamingTextSegments(segments) {
  return (Array.isArray(segments) ? segments : []).map((seg) =>
    seg.type === "text" ? { ...seg, isStreaming: false } : seg,
  );
}

export function hasThinkingSegment(segments) {
  return (Array.isArray(segments) ? segments : []).some(
    (seg) => seg.type === "thinking" && String(seg.text || "").trim(),
  );
}

export function getReasoningTextFromAssistantMessage(message = {}) {
  if (
    typeof message.reasoning_content === "string" &&
    message.reasoning_content.trim()
  ) {
    return message.reasoning_content.trim();
  }
  if (!Array.isArray(message.reasoning_details)) return "";
  return message.reasoning_details
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      if (block.type === "thinking") return block.thinking || block.text || "";
      if (block.type === "reasoning" || block.type === "reasoning_content") {
        return block.text || block.reasoning_content || "";
      }
      if (block.type === "redacted_thinking") return "[redacted thinking]";
      return "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

export function appendUniqueFileChanges(current = [], next = []) {
  const output = Array.isArray(current) ? [...current] : [];
  const seen = new Set(
    output.map((item) => `${item?.path || ""}:${item?.status || ""}`),
  );
  for (const item of Array.isArray(next) ? next : []) {
    const key = `${item?.path || ""}:${item?.status || ""}`;
    if (!item?.path || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function defaultStripText(text) {
  return String(text || "");
}

function defaultFormatToolLabel(name) {
  return coreFormatToolLabel(name);
}

function isCreatePlanToolCard(card) {
  const name = String(card?.name || "")
    .toLowerCase()
    .replace(/\(.*$/, "");
  return name === "create_plan" || name === "run_subagent" || Boolean(card?.planRun);
}

/**
 * Keep only early preamble (before plan steps exist) above a trailing create_plan
 * card. Once the plan is executing/settled, later body text must stay below it.
 */
function shouldParkPreambleBeforeCreatePlan(card) {
  if (!isCreatePlanToolCard(card)) return false;
  const status = String(card?.status || "").toLowerCase();
  if (status === "done" || status === "error" || status === "blocked") return false;
  const phase = String(card?.planRun?.phase || "").toLowerCase();
  if (["executing", "completed", "failed", "aborted"].includes(phase)) {
    return false;
  }
  if (Array.isArray(card?.planRun?.steps) && card.planRun.steps.length > 0) {
    return false;
  }
  return true;
}

/** Keep preamble text/thinking before a trailing create_plan tool card. */
function indexBeforeTrailingCreatePlan(segments = []) {
  const current = Array.isArray(segments) ? segments : [];
  for (let index = current.length - 1; index >= 0; index -= 1) {
    const segment = current[index];
    if (
      segment?.type === "text" ||
      segment?.type === "thinking" ||
      segment?.type === "handoff"
    ) {
      continue;
    }
    if (segment?.type !== "tools" || !Array.isArray(segment.cards)) break;
    const planCard = segment.cards.find(isCreatePlanToolCard);
    if (!planCard || !shouldParkPreambleBeforeCreatePlan(planCard)) break;
    return index;
  }
  return -1;
}

function buildToolCardFromEvent(event, options = {}) {
  const formatToolLabel = options.formatToolLabel || defaultFormatToolLabel;
  if (event.type === "assistant:tool_call_delta") {
    const toolCall = event.toolCall || {};
    const toolName = String(toolCall.name || "").trim();
    const toolId =
      String(toolCall.id || "").trim() ||
      `stream-tool-${Number.isFinite(Number(toolCall.index)) ? Number(toolCall.index) : 0}`;
    return {
      id: toolId,
      name: toolName || "tool",
      displayName: toolName
        ? formatToolLabel(toolName)
        : formatToolLabel("tool"),
      arguments: toolCall.arguments || "",
      status: "running",
      startedAt: event.startedAt || new Date().toISOString(),
      durationMs: null,
      summary: "",
      result: "",
    };
  }
  return {
    id: event.id,
    name: event.name,
    displayName: event.displayName || formatToolLabel(event.name),
    arguments: event.arguments,
    status: "running",
    startedAt: event.startedAt || new Date().toISOString(),
    durationMs: null,
    summary: "",
    result: "",
  };
}

function eventFileChanges(event) {
  if (Array.isArray(event.fileChanges) && event.fileChanges.length) {
    return event.fileChanges;
  }
  if (event.fileChange) return [event.fileChange];
  return [];
}

/**
 * Apply a stream/transcript event to a single UI message.
 * Session-level concerns (creating messages, plan overview) stay outside.
 */
export function applyStreamEventToMessage(message, event, options = {}) {
  if (!message || !event?.type) return message;
  const stripText = options.stripText || defaultStripText;
  const finishThinkingBeforeText = options.finishThinkingBeforeText !== false;

  switch (event.type) {
    case "assistant:delta": {
      const delta = stripText(event.text);
      if (!delta) return message;
      const baseSegments = finishThinkingBeforeText
        ? finishThinkingSegments(message.segments)
        : message.segments;
      return {
        ...message,
        segments: appendTextSegment(baseSegments, delta, true),
      };
    }
    case "assistant:reasoning_delta": {
      if (!event.text) return message;
      return {
        ...message,
        segments: appendThinkingSegment(message.segments, event.text, true),
      };
    }
    case "assistant:response": {
      const reasoningText = getReasoningTextFromAssistantMessage(
        event.assistantMessage,
      );
      let next = message;
      if (reasoningText && !hasThinkingSegment(message.segments)) {
        next = {
          ...next,
          segments: appendThinkingSegment(
            next.segments,
            reasoningText,
            false,
          ),
        };
      }
      const incomingUsage =
        event.usage || event.assistantMessage?.usage || null;
      if (incomingUsage) {
        next = {
          ...next,
          usage: mergeUsage(next.usage, incomingUsage),
        };
      }
      const text = event.text ? stripText(event.text) : "";
      let segments = finishThinkingSegments(next.segments);
      if (text) {
        segments = replaceLastTextSegment(segments, text, false);
      } else {
        segments = finishStreamingTextSegments(segments);
      }
      return {
        ...next,
        ...(options.markCompleteOnResponse ? { isComplete: true } : {}),
        segments,
      };
    }
    case "assistant:usage": {
      const incomingUsage = normalizeUsage(event.usage);
      if (!incomingUsage) return message;
      return {
        ...message,
        usage: mergeUsage(message.usage, incomingUsage),
      };
    }
    case "assistant:tool_call_delta":
    case "tool:start": {
      const toolCard = buildToolCardFromEvent(event, options);
      if (!toolCard?.id) return message;
      const baseSegments = finishThinkingBeforeText
        ? finishThinkingSegments(message.segments)
        : message.segments;
      return {
        ...message,
        segments: ["tasks", "update_todos"].includes(String(toolCard.name || "").toLowerCase())
          ? upsertSingletonToolCardInSegments(baseSegments, toolCard)
          : upsertToolCardInSegments(baseSegments, toolCard),
      };
    }
    case "tool:result": {
      const { segments, updated } = updateToolInSegments(
        message.segments,
        event,
        (card) => ({
          ...card,
          id: event.id || card.id,
          name: event.name || card.name,
          displayName: event.displayName || card.displayName,
          result: event.content || "",
        }),
      );
      return updated ? { ...message, segments } : message;
    }
    case "tool:end":
    case "tool:error":
    case "tool:blocked": {
      const changes = eventFileChanges(event);
      const { segments, updated } = updateToolInSegments(
        message.segments,
        event,
        (card) => {
          if (event.type === "tool:blocked") {
            return {
              ...card,
              id: event.id || card.id,
              name: event.name || card.name,
              displayName: event.displayName || card.displayName,
              status: "blocked",
              summary: event.summary || card.summary || "Tool blocked",
            };
          }
          if (event.type === "tool:error") {
            return {
              ...card,
              id: event.id || card.id,
              name: event.name || card.name,
              displayName: event.displayName || card.displayName,
              status: "error",
              durationMs: event.durationMs,
              summary: event.summary || card.summary,
            };
          }
          return {
            ...card,
            id: event.id || card.id,
            name: event.name || card.name,
            displayName: event.displayName || card.displayName,
            status: "done",
            durationMs: event.durationMs,
            ...(event.summary ? { summary: event.summary } : {}),
            ...(event.resultMeta ? { resultMeta: event.resultMeta } : {}),
            ...(event.fileChange ? { fileChange: event.fileChange } : {}),
            ...(changes.length ? { fileChanges: changes } : {}),
          };
        },
      );
      if (!updated) return message;
      return {
        ...message,
        segments,
        fileChanges: changes.length
          ? appendUniqueFileChanges(message.fileChanges, changes)
          : message.fileChanges,
      };
    }
    case "skill:start": {
      const baseSegments = finishThinkingBeforeText
        ? finishThinkingSegments(message.segments)
        : message.segments;
      return {
        ...message,
        segments: addSkillToSegments(baseSegments, event),
      };
    }
    case "skill:end": {
      const endedAt = event.endedAt || new Date().toISOString();
      return {
        ...message,
        segments: updateSkillInSegments(
          message.segments,
          event.name,
          (segment) => ({
            ...segment,
            status: "done",
            ...(event.summary ? { summary: event.summary } : {}),
            endedAt,
          }),
        ),
      };
    }
    case "skill:error": {
      const endedAt = event.endedAt || new Date().toISOString();
      return {
        ...message,
        segments: updateSkillInSegments(
          message.segments,
          event.name,
          (segment) => ({
            ...segment,
            status: "error",
            ...(event.summary ? { summary: event.summary } : {}),
            endedAt,
          }),
        ),
      };
    }
    case "hook:start": {
      const hookEvent = buildHookSegmentEvent(event);
      const baseSegments = finishThinkingBeforeText
        ? finishThinkingSegments(message.segments)
        : message.segments;
      return {
        ...message,
        segments: addSkillToSegments(baseSegments, {
          ...hookEvent,
          startedAt: event.startedAt || hookEvent.startedAt,
        }),
      };
    }
    case "hook:end":
    case "hook:error": {
      const hookEvent = buildHookSegmentEvent(event);
      const endedAt = event.endedAt || new Date().toISOString();
      const status =
        event.type === "hook:error" ||
        event.decision === "deny" ||
        event.ok === false
          ? "error"
          : "done";
      return {
        ...message,
        segments: updateSkillInSegments(
          message.segments,
          hookEvent.name,
          (segment) => ({
            ...segment,
            kind: "hook",
            event: hookEvent.event || segment.event,
            source: hookEvent.source || segment.source,
            sourceLabel: hookEvent.sourceLabel || segment.sourceLabel,
            toolName: hookEvent.toolName || segment.toolName,
            matcher: hookEvent.matcher || segment.matcher,
            command: hookEvent.command || segment.command,
            status,
            summary:
              event.error ||
              event.reason ||
              event.summary ||
              event.command ||
              segment.summary,
            reason: event.reason || event.error || segment.reason,
            endedAt,
          }),
        ),
      };
    }
    default:
      return message;
  }
}

export function isTranscriptStreamEvent(type) {
  const value = String(type || "");
  return (
    value === "assistant:delta" ||
    value === "assistant:reasoning_delta" ||
    value === "assistant:response" ||
    value === "assistant:usage" ||
    value === "assistant:tool_call_delta" ||
    value === "tool:start" ||
    value === "tool:end" ||
    value === "tool:result" ||
    value === "tool:error" ||
    value === "tool:blocked" ||
    value === "skill:start" ||
    value === "skill:end" ||
    value === "skill:error" ||
    value === "hook:start" ||
    value === "hook:end" ||
    value === "hook:error"
  );
}
