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
  return {
    ...state,
    currentSessionId: sessionId,
    messages: state.sessionMessagesById?.[sessionId] || [],
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
    runtime = {
      ...previous,
      status: event.result?.type === "error" ? "failed" : "completed",
      busy: false,
      sessionId,
    };
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
  const messageId =
    event.messageId || event.operationId || `session-stream-${sessionId}`;
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
                const textIndex = segments.findIndex(
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
    return persistedId ? { ...message, id: persistedId } : message;
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
