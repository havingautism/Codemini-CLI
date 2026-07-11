import {
  updateToolInSegments,
  upsertToolCardInSegments,
} from "../../../shared/tool-segments.js";

function mergeSessionUsage(current, incoming) {
  if (!incoming || typeof incoming !== "object") return current;
  if (!current || typeof current !== "object") return { ...incoming };
  const out = { ...current };
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
    const a = Number(current[key] || 0);
    const b = Number(incoming[key] || 0);
    if (a + b > 0) out[key] = Math.round(a + b);
  }
  return out;
}

function createSkillSegment(event, status = "running") {
  const now = new Date().toISOString();
  return {
    type: "skill",
    name: event.name,
    status,
    startedAt: event.startedAt || now,
    ...(status === "done" || status === "error"
      ? { endedAt: event.endedAt || now }
      : {}),
    ...(status === "error" && event.summary ? { summary: event.summary } : {}),
  };
}

function addSkillToSegments(segments, event) {
  const source = Array.isArray(segments) ? segments : [];
  const existingIndex = source.findIndex(
    (segment) => segment?.type === "skill" && segment.name === event.name,
  );
  if (existingIndex === -1) return [...source, createSkillSegment(event)];
  return source.map((segment, index) =>
    index === existingIndex ? createSkillSegment(event) : segment,
  );
}

function updateSkillInSegments(segments, name, updater) {
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

function appendUniqueFileChanges(current = [], next = []) {
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

export function createSessionState(overrides = {}) {
  return {
    currentSessionId: null,
    sessionRuntimeById: {},
    sessionMessagesById: {},
    ...overrides,
  };
}

export function hydrateSessionRuntimes(state, runtimes = {}) {
  const sessionRuntimeById = { ...state.sessionRuntimeById };
  for (const [sessionId, runtime] of Object.entries(runtimes || {})) {
    sessionRuntimeById[sessionId] = {
      ...sessionRuntimeById[sessionId],
      ...runtime,
      sessionId,
    };
  }
  return { ...state, sessionRuntimeById };
}

export function activateSession(state, sessionId) {
  if (!sessionId || sessionId === state.currentSessionId) return state;
  const runtime = state.sessionRuntimeById?.[sessionId];
  return {
    ...state,
    currentSessionId: sessionId,
    messages: state.sessionMessagesById?.[sessionId] || [],
    ...(runtime
      ? {
          runtimeState: runtime,
          approvalRequest: runtime.pendingApproval || null,
          userInputRequest: runtime.pendingUserInput || null,
        }
      : {}),
  };
}

export function projectVisibleSessionState(state) {
  const runtime = state.sessionRuntimeById?.[state.currentSessionId];
  const hasSessionMessages = Object.prototype.hasOwnProperty.call(
    state.sessionMessagesById || {},
    state.currentSessionId,
  );
  if (!runtime && !hasSessionMessages) return state;
  const busy = runtime
    ? typeof runtime.busy === "boolean"
      ? runtime.busy
      : ["queued", "running", "waiting", "waiting_approval", "waiting_input"].includes(
          runtime.status,
        )
    : false;
  return {
    ...state,
    busy,
    live: busy,
    ...(hasSessionMessages
      ? { messages: state.sessionMessagesById[state.currentSessionId] }
      : {}),
    ...(runtime
      ? {
          runtimeState: runtime,
          approvalRequest: runtime.pendingApproval || null,
          userInputRequest: runtime.pendingUserInput || null,
        }
      : {}),
    ...(!busy ? { stage: "idle", stageLabel: "" } : {}),
  };
}

export async function runSessionOperation(inFlight, sessionId, operation) {
  if (inFlight.has(sessionId)) {
    throw new Error("A session operation is already in flight");
  }
  inFlight.add(sessionId);
  try {
    return await operation();
  } finally {
    inFlight.delete(sessionId);
  }
}

export function reduceSessionRuntimeEvent(state, event) {
  const sessionId = String(event?.sessionId || "").trim();
  if (!sessionId) return state;

  const previous = state.sessionRuntimeById[sessionId] || { sessionId };
  let runtime = previous;
  if (event.type === "runtime:state") {
    runtime = { ...previous, ...(event.state || {}), sessionId };
  } else if (event.type === "runtime_pool_state") {
    runtime = {
      ...previous,
      ...(event.state || {}),
      ...(previous.pendingApproval &&
      event.state?.status !== "waiting_approval"
        ? { pendingApproval: null }
        : {}),
      ...(previous.pendingUserInput &&
      event.state?.status !== "waiting_input"
        ? { pendingUserInput: null }
        : {}),
      sessionId,
    };
  } else if (event.type === "approval:request") {
    runtime = { ...previous, pendingApproval: event, sessionId };
  } else if (event.type === "approval:resolved") {
    runtime = { ...previous, pendingApproval: null, sessionId };
  } else if (event.type === "user-input:request") {
    runtime = {
      ...previous,
      pendingUserInput: event.request
        ? { ...event.request, sessionId }
        : null,
      sessionId,
    };
  } else if (event.type === "user-input:resolved") {
    runtime = { ...previous, pendingUserInput: null, sessionId };
  } else if (event.type === "mode:changed") {
    runtime = { ...previous, ...event, sessionId };
  } else if (event.type === "approval-mode:changed") {
    runtime = { ...previous, ...event, sessionId };
  } else if (event.type === "submit:start") {
    runtime = { ...previous, status: "running", busy: true, sessionId };
  } else if (event.type === "submit:done") {
    if (previous.pendingApproval || previous.pendingUserInput) {
      // Keep the interaction UI open. Pool may still be (or return to)
      // waiting_*; clearing here caused false "completed" + recovered clicks.
      runtime = {
        ...previous,
        busy: true,
        sessionId,
      };
    } else {
      runtime = {
        ...previous,
        status: event.result?.type === "error" ? "failed" : "completed",
        busy: false,
        pendingApproval: null,
        pendingUserInput: null,
        sessionId,
      };
    }
  }

  if (runtime === previous) return state;
  return {
    ...state,
    sessionRuntimeById: {
      ...state.sessionRuntimeById,
      [sessionId]: runtime,
    },
  };
}

export function reduceSessionTranscriptEvent(state, event) {
  const sessionId = String(event?.sessionId || "").trim();
  if (!sessionId) return state;

  let sessionMessagesById = state.sessionMessagesById;
  const messages = state.sessionMessagesById[sessionId] || [];
  const messageId = (() => {
    if (event.messageId || event.operationId) {
      return event.messageId || event.operationId;
    }
    if (event.type !== "assistant:start") {
      const liveMessage = [...messages]
        .reverse()
        .find((message) => message && message.isComplete !== true);
      if (liveMessage?.id) return liveMessage.id;
      const latestMessage = messages.at(-1);
      if (latestMessage?.id) return latestMessage.id;
    }
    return `session-stream-${sessionId}`;
  })();
  if (event.type === "assistant:start") {
    const existing = messages.some((message) => message.id === messageId);
    if (!existing) {
      sessionMessagesById = {
        ...sessionMessagesById,
        [sessionId]: [
          ...messages,
          {
            id: messageId,
            role: "general",
            segments: [],
            skillBadges: [],
            fileChanges: [],
            isComplete: false,
          },
        ],
      };
    } else {
      // Reset isComplete so that parallel-session switching can
      // correctly identify this message as still in progress.
      sessionMessagesById = {
        ...sessionMessagesById,
        [sessionId]: messages.map((message) =>
          message.id === messageId
            ? { ...message, isComplete: false }
            : message
        ),
      };
    }
  } else if (
    event.type === "assistant:delta" ||
    event.type === "assistant:reasoning_delta"
  ) {
    const segmentType =
      event.type === "assistant:reasoning_delta" ? "thinking" : "text";
    sessionMessagesById = {
      ...sessionMessagesById,
      [sessionId]: messages.map((message) => {
        if (message.id !== messageId) return message;
        const segments = [...(message.segments || [])];
        const last = segments.at(-1);
        if (last?.type === segmentType) {
          segments[segments.length - 1] = {
            ...last,
            text: `${last.text || ""}${event.text || ""}`,
            isStreaming: true,
          };
        } else {
          segments.push({
            type: segmentType,
            text: event.text || "",
            isStreaming: true,
          });
        }
        return { ...message, segments };
      }),
    };
  } else if (event.type === "assistant:response") {
    const incomingUsage = event.usage || event.assistantMessage?.usage || null;
    sessionMessagesById = {
      ...sessionMessagesById,
      [sessionId]: messages.map((message) =>
        message.id === messageId
          ? {
              ...message,
              isComplete: true,
              ...(incomingUsage
                ? { usage: mergeSessionUsage(message.usage, incomingUsage) }
                : {}),
              segments: (() => {
                const segments = (message.segments || []).map((segment) => ({
                  ...segment,
                  isStreaming: false,
                }));
                if (!event.text) return segments;
                const textIndex = segments.findLastIndex(
                  (segment) => segment.type === "text",
                );
                if (textIndex === -1) {
                  segments.push({
                    type: "text",
                    text: event.text,
                    isStreaming: false,
                  });
                } else {
                  segments[textIndex] = {
                    ...segments[textIndex],
                    text: event.text,
                    isStreaming: false,
                  };
                }
                return segments;
              })(),
            }
          : message,
      ),
    };
  } else if (event.type === "skill:start") {
    sessionMessagesById = {
      ...sessionMessagesById,
      [sessionId]: messages.map((message) =>
        message.id === messageId
          ? {
              ...message,
              segments: addSkillToSegments(message.segments, event),
            }
          : message,
      ),
    };
  } else if (event.type === "skill:end" || event.type === "skill:error") {
    const status = event.type === "skill:error" ? "error" : "done";
    sessionMessagesById = {
      ...sessionMessagesById,
      [sessionId]: messages.map((message) =>
        message.id === messageId
          ? {
              ...message,
              segments: updateSkillInSegments(
                message.segments,
                event.name,
                (segment) => ({
                  ...segment,
                  status,
                  ...(event.summary ? { summary: event.summary } : {}),
                  endedAt: event.endedAt || new Date().toISOString(),
                }),
              ),
            }
          : message,
      ),
    };
  } else if (event.type === "tool:start" || event.type === "assistant:tool_call_delta") {
    const toolCall = event.toolCall || {};
    const toolId =
      event.type === "assistant:tool_call_delta"
        ? String(toolCall.id || "").trim() ||
          `stream-tool-${Number.isFinite(Number(toolCall.index)) ? Number(toolCall.index) : 0}`
        : event.id;
    const toolName =
      event.type === "assistant:tool_call_delta"
        ? String(toolCall.name || "").trim() || "tool"
        : event.name;
    const toolCard = {
      id: toolId,
      name: toolName,
      displayName:
        event.displayName ||
        (event.type === "assistant:tool_call_delta" ? toolName : event.name),
      arguments:
        event.type === "assistant:tool_call_delta"
          ? toolCall.arguments || ""
          : event.arguments,
      status: "running",
      durationMs: null,
      summary: "",
      result: "",
    };
    sessionMessagesById = {
      ...sessionMessagesById,
      [sessionId]: messages.map((message) =>
        message.id === messageId
          ? {
              ...message,
              segments: upsertToolCardInSegments(message.segments, toolCard),
            }
          : message,
      ),
    };
  } else if (event.type === "tool:result") {
    sessionMessagesById = {
      ...sessionMessagesById,
      [sessionId]: messages.map((message) => {
        if (message.id !== messageId) return message;
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
      }),
    };
  } else if (
    event.type === "tool:end" ||
    event.type === "tool:error" ||
    event.type === "tool:blocked"
  ) {
    const eventChanges =
      Array.isArray(event.fileChanges) && event.fileChanges.length
        ? event.fileChanges
        : event.fileChange
          ? [event.fileChange]
          : [];
    sessionMessagesById = {
      ...sessionMessagesById,
      [sessionId]: messages.map((message) => {
        if (message.id !== messageId) return message;
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
              ...(eventChanges.length ? { fileChanges: eventChanges } : {}),
            };
          },
        );
        return updated
          ? {
              ...message,
              segments,
              fileChanges: eventChanges.length
                ? appendUniqueFileChanges(message.fileChanges, eventChanges)
                : message.fileChanges,
            }
          : message;
      }),
    };
  }

  if (sessionMessagesById === state.sessionMessagesById) return state;
  return {
    ...state,
    sessionMessagesById,
  };
}

export function reduceSessionEvent(state, event) {
  return reduceSessionTranscriptEvent(
    reduceSessionRuntimeEvent(state, event),
    event,
  );
}

function isLegacyStreamMessage(message) {
  return /^session-stream-/.test(String(message?.id || ""));
}

function isAssistantMessage(message) {
  return (
    message &&
    !["you", "divider", "system"].includes(String(message.role || ""))
  );
}

function isAlignableAssistantMessage(message) {
  return (
    isAssistantMessage(message) &&
    !message.transientKey &&
    !message.planStep &&
    !message.planOverview
  );
}

function alignSessionMessages(processed, uiMessages, predicate) {
  const restoredMessages = Array.isArray(processed) ? processed : [];
  const persistedMessages = (
    Array.isArray(uiMessages) ? uiMessages : []
  ).filter(
    predicate,
  );
  let persistedIndex = 0;
  const aligned = restoredMessages.map((message) => {
    if (!predicate(message)) return message;
    const persistedMessage = persistedMessages[persistedIndex++];
    const persistedId = String(persistedMessage?.id || "").trim();
    return persistedId
      ? {
          ...message,
          id: persistedId,
          ...(typeof persistedMessage.isComplete === "boolean"
            ? { isComplete: persistedMessage.isComplete }
            : {}),
        }
      : message;
  });
  return [...aligned, ...persistedMessages.slice(persistedIndex)];
}

export function alignSessionAssistantMessages(processed = [], uiMessages = []) {
  return alignSessionMessages(
    processed,
    uiMessages,
    isAlignableAssistantMessage,
  );
}

export function alignSessionUserMessages(processed = [], uiMessages = []) {
  return alignSessionMessages(
    processed,
    uiMessages,
    (message) => message?.role === "you" && !message.transientKey,
  );
}

function skillBadgeKey(badge = {}) {
  return `${String(badge.status || "done")}::${String(badge.name || "").trim()}`;
}

function appendUniqueSkillBadges(current = [], next = []) {
  const output = Array.isArray(current) ? [...current] : [];
  const seen = new Set(output.map(skillBadgeKey));
  for (const badge of Array.isArray(next) ? next : []) {
    const key = skillBadgeKey(badge);
    if (!String(badge?.name || "").trim() || seen.has(key)) continue;
    seen.add(key);
    output.push(badge);
  }
  return output;
}

function mergeSkillSegments(processedSegments, uiSegments) {
  const uiSkills = (Array.isArray(uiSegments) ? uiSegments : []).filter(
    (segment) => segment?.type === "skill",
  );
  if (!uiSkills.length) return processedSegments;

  const processed = Array.isArray(processedSegments)
    ? [...processedSegments]
    : [];
  const existing = new Set(
    processed
      .filter((segment) => segment?.type === "skill")
      .map(
        (segment) =>
          `${segment.name}::${segment.status}::${segment.startedAt || ""}`,
      ),
  );
  const additions = uiSkills.filter((segment) => {
    const key = `${segment.name}::${segment.status}::${segment.startedAt || ""}`;
    return !existing.has(key);
  });
  if (!additions.length) return processedSegments;

  const firstContentIndex = processed.findIndex(
    (segment) => segment?.type !== "skill",
  );
  if (firstContentIndex === -1) return [...processed, ...additions];
  return [
    ...processed.slice(0, firstContentIndex),
    ...additions,
    ...processed.slice(firstContentIndex),
  ];
}

export function mergeAlignedUserContext(processed = [], uiMessages = []) {
  const uiUsersById = new Map(
    (Array.isArray(uiMessages) ? uiMessages : [])
      .filter((message) => message?.role === "you" && !message.transientKey)
      .map((message) => [String(message.id || "").trim(), message])
      .filter(([id]) => id),
  );
  if (!uiUsersById.size) return processed;

  return (Array.isArray(processed) ? processed : []).map((message) => {
    if (message?.role !== "you") return message;
    const uiMessage = uiUsersById.get(String(message.id || "").trim());
    if (!uiMessage) return message;
    const attachments = Array.isArray(uiMessage.attachments)
      ? uiMessage.attachments.filter(Boolean)
      : [];
    const skillBadges = Array.isArray(uiMessage.skillBadges)
      ? uiMessage.skillBadges.filter(Boolean)
      : [];
    if (!attachments.length && !skillBadges.length) return message;
    return {
      ...message,
      ...(attachments.length ? { attachments } : {}),
      ...(skillBadges.length
        ? {
            skillBadges: appendUniqueSkillBadges(
              message.skillBadges || [],
              skillBadges,
            ),
          }
        : {}),
    };
  });
}

export function mergeAlignedAssistantSkillContext(
  processed = [],
  uiMessages = [],
) {
  const uiAssistantsById = new Map(
    (Array.isArray(uiMessages) ? uiMessages : [])
      .filter(isAlignableAssistantMessage)
      .map((message) => [String(message.id || "").trim(), message])
      .filter(([id]) => id),
  );
  if (!uiAssistantsById.size) return processed;

  return (Array.isArray(processed) ? processed : []).map((message) => {
    if (!isAlignableAssistantMessage(message)) return message;
    const uiMessage = uiAssistantsById.get(String(message.id || "").trim());
    if (!uiMessage) return message;
    const skillBadges = Array.isArray(uiMessage.skillBadges)
      ? uiMessage.skillBadges
      : [];
    const segments = mergeSkillSegments(message.segments, uiMessage.segments);
    if (!skillBadges.length && segments === message.segments) return message;
    return {
      ...message,
      ...(skillBadges.length
        ? {
            skillBadges: appendUniqueSkillBadges(
              message.skillBadges || [],
              skillBadges,
            ),
          }
        : {}),
      ...(segments !== message.segments ? { segments } : {}),
    };
  });
}

function mergeSnapshotMessage(serverMessage, cachedMessage) {
  const preferCached = serverMessage?.isComplete !== true;
  return preferCached
    ? { ...serverMessage, ...cachedMessage, id: serverMessage.id }
    : { ...cachedMessage, ...serverMessage, id: serverMessage.id };
}

function userMessageFingerprint(message) {
  if (message?.role !== "you") return "";
  const segmentText = (Array.isArray(message.segments) ? message.segments : [])
    .filter((segment) => segment?.type === "text")
    .map((segment) => String(segment.text || ""))
    .join("");
  return String(message.text || message.content || segmentText).trim();
}

export function reconcileSessionMessages(snapshot = [], cached = []) {
  const serverMessages = Array.isArray(snapshot) ? snapshot : [];
  const cachedMessages = Array.isArray(cached) ? cached : [];
  const cachedById = new Map(
    cachedMessages
      .filter((message) => String(message?.id || "").trim())
      .map((message) => [message.id, message]),
  );
  const seen = new Set();
  const merged = serverMessages.map((serverMessage) => {
    const id = String(serverMessage?.id || "").trim();
    if (id) seen.add(id);
    const cachedMessage = id ? cachedById.get(id) : null;
    return cachedMessage
      ? mergeSnapshotMessage(serverMessage, cachedMessage)
      : serverMessage;
  });
  const unmatchedServerUsers = new Map();
  merged.forEach((message, index) => {
    const id = String(message?.id || "").trim();
    const fingerprint = userMessageFingerprint(message);
    if (!fingerprint || (id && cachedById.has(id))) return;
    const indexes = unmatchedServerUsers.get(fingerprint) || [];
    indexes.push(index);
    unmatchedServerUsers.set(fingerprint, indexes);
  });

  for (const cachedMessage of cachedMessages) {
    const id = String(cachedMessage?.id || "").trim();
    if (!id || seen.has(id)) continue;
    const userFingerprint = userMessageFingerprint(cachedMessage);
    const matchingUserIndexes = userFingerprint
      ? unmatchedServerUsers.get(userFingerprint)
      : null;
    if (matchingUserIndexes?.length) {
      const serverIndex = matchingUserIndexes.shift();
      merged[serverIndex] = mergeSnapshotMessage(
        merged[serverIndex],
        cachedMessage,
      );
      continue;
    }
    if (isLegacyStreamMessage(cachedMessage)) {
      const activeServerIndex = merged.findLastIndex(
        (message) => isAssistantMessage(message) && message.isComplete !== true,
      );
      if (activeServerIndex !== -1) {
        merged[activeServerIndex] = mergeSnapshotMessage(
          merged[activeServerIndex],
          cachedMessage,
        );
        continue;
      }
    }
    merged.push(cachedMessage);
    seen.add(id);
  }

  return merged;
}
