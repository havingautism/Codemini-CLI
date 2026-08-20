import {
  applyStreamEventToMessage,
  isTranscriptStreamEvent,
} from "../../../shared/transcript-segments.js";
import { stripPlanProgressText } from "../../../shared/plan-progress-text.js";
import {
  applyPlanEventToMessage,
  applyStreamEventToPlanRun,
  findActivePlanParentMessage,
  isCreatePlanToolEvent,
  isLegacyFinalPlanStep,
  isPlanTranscriptEvent,
  shouldNestStreamEventInPlan,
  settleCompletedPlanToolCards,
} from "./plan-ui-state.js";
import { sessionRuntimeIsBusy } from "./session-ui-state.js";

const SESSION_SCOPED_RUNTIME_KEYS = new Set([
  "sessionId",
  "busy",
  "status",
  "queuePosition",
  "pendingApproval",
  "pendingUserInput",
  "pendingSpecApproval",
  "pendingReflectSkill",
  "requestInFlight",
  "needsAttention",
  "parallelWriteRisk",
]);

function projectIdleRuntimeState(previous, sessionId) {
  const next = {
    sessionId,
    busy: false,
    status: "idle",
  };
  if (!previous || typeof previous !== "object") return next;
  for (const [key, value] of Object.entries(previous)) {
    if (SESSION_SCOPED_RUNTIME_KEYS.has(key)) continue;
    next[key] = value;
  }
  return next;
}

export function isSessionBusyInState(state, sessionId) {
  return sessionRuntimeIsBusy(state?.sessionRuntimeById?.[sessionId]);
}

// Legacy persisted waiting bubbles may have lost their transientKey on the
// server round-trip. Match only the exact known labels instead of a substring
// so a real system message merely containing the phrase is never dropped.
const WAITING_RESPONSE_TEXT = new Set([
  "等待回复",
  "等待回复…",
  "正在等待回复",
  "正在等待回复…",
  "Waiting for response",
  "Waiting for response…",
]);

function isWaitingResponseMessage(message) {
  if (!message) return false;
  if (message.transientKey === "waiting-response") return true;
  const text = String(message.text || "").trim();
  return message.role === "system" && WAITING_RESPONSE_TEXT.has(text);
}

function withoutWaitingResponseMessages(messages = []) {
  return (Array.isArray(messages) ? messages : []).filter(
    (message) => !isWaitingResponseMessage(message),
  );
}

function planStepNumberFromMessageId(messageId) {
  const match = String(messageId || "").match(/^plan-step-(\d+)(?:-|$)/);
  if (!match) return null;
  const step = Number(match[1]);
  return Number.isFinite(step) ? step : null;
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
  const busy = sessionRuntimeIsBusy(runtime);
  return {
    ...state,
    currentSessionId: sessionId,
    messages: state.sessionMessagesById?.[sessionId] || [],
    busy,
    live: busy,
    stage: busy ? state.stage : "idle",
    stageLabel: busy ? state.stageLabel : "",
    runtimeState: runtime
      ? { ...runtime, sessionId }
      : projectIdleRuntimeState(state.runtimeState, sessionId),
    approvalRequest: runtime?.pendingApproval || null,
    userInputRequest: runtime?.pendingUserInput || null,
    ...(!runtime
      ? {
          sessionRuntimeById: {
            ...state.sessionRuntimeById,
            [sessionId]: {
              sessionId,
              status: "idle",
              busy: false,
            },
          },
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
  if (!runtime && !hasSessionMessages) {
    return {
      ...state,
      busy: false,
      live: false,
      stage: "idle",
      stageLabel: "",
      approvalRequest: null,
      userInputRequest: null,
      runtimeState: projectIdleRuntimeState(
        state.runtimeState,
        state.currentSessionId,
      ),
    };
  }
  const busy = sessionRuntimeIsBusy(runtime);
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
      : {
          runtimeState: projectIdleRuntimeState(
            state.runtimeState,
            state.currentSessionId,
          ),
          approvalRequest: null,
          userInputRequest: null,
        }),
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

function restoreSandboxMode(current, previous, optimisticMode) {
  if (!current || current.sandboxMode !== optimisticMode) return current;
  const restored = { ...current };
  if (Object.hasOwn(previous || {}, "sandboxMode")) {
    restored.sandboxMode = previous.sandboxMode;
  } else {
    delete restored.sandboxMode;
  }
  return restored;
}

export function rollbackOptimisticSandboxMode(state, {
  sessionId,
  optimisticMode,
  previousRuntime,
  previousSessionRuntime,
}) {
  const runtimeState = restoreSandboxMode(
    state.runtimeState,
    previousRuntime,
    optimisticMode,
  );
  let sessionRuntimeById = state.sessionRuntimeById;
  const currentSessionRuntime = sessionRuntimeById?.[sessionId];
  const restoredSessionRuntime = restoreSandboxMode(
    currentSessionRuntime,
    previousSessionRuntime,
    optimisticMode,
  );
  if (restoredSessionRuntime !== currentSessionRuntime) {
    sessionRuntimeById = { ...sessionRuntimeById };
    if (
      !previousSessionRuntime &&
      Object.keys(restoredSessionRuntime).every((key) => key === "sessionId")
    ) {
      delete sessionRuntimeById[sessionId];
    } else {
      sessionRuntimeById[sessionId] = restoredSessionRuntime;
    }
  }
  if (
    runtimeState === state.runtimeState &&
    sessionRuntimeById === state.sessionRuntimeById
  ) {
    return state;
  }
  return { ...state, runtimeState, sessionRuntimeById };
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
  } else if (event.type === "sandbox-mode:changed") {
    const { type: _type, ...rest } = event;
    runtime = { ...previous, ...rest, sessionId };
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
  const activePlanParent = findActivePlanParentMessage(messages);
  const messageId = (() => {
    // While a plan card is running, keep nested agent streams on that parent.
    if (
      activePlanParent?.id &&
      activePlanParent.manualAborted !== true &&
      !isCreatePlanToolEvent(event)
    ) {
      return activePlanParent.id;
    }
    const requested = String(event.messageId || event.operationId || "").trim();
    const requestedMessage = requested
      ? messages.find((message) => message?.id === requested)
      : null;
    if (requested && requestedMessage?.manualAborted !== true) {
      return requested;
    }
    if (event.type !== "assistant:start") {
      const liveMessage = [...messages]
        .reverse()
        .find(
          (message) =>
            message &&
            message.isComplete !== true &&
            message.manualAborted !== true &&
            !message.transientKey,
        );
      if (liveMessage?.id) return liveMessage.id;
    }
    return `session-stream-${sessionId}-${Date.now()}`;
  })();
  if (event.type === "assistant:start") {
    // Plan-internal assistant turns must not spawn sibling bubbles.
    if (activePlanParent?.id) {
      sessionMessagesById = {
        ...sessionMessagesById,
        [sessionId]: messages.map((message) =>
          message.id === activePlanParent.id
            ? { ...message, isComplete: false }
            : message,
        ),
      };
    } else {
      const existing = messages.some((message) => message.id === messageId);
      if (!existing) {
        // During create_plan, the client may already own a plan-step bubble
        // under a locally generated id while SSE streams use the server id.
        // Only adopt when both ids are clearly the same plan step — never steal
        // a stale plan bubble into a normal chat turn.
        const messageStep = planStepNumberFromMessageId(messageId);
        const livePlanStep =
          messageStep == null
            ? null
            : [...messages]
                .reverse()
                .find(
                  (message) =>
                    message?.planStep &&
                    message.isComplete !== true &&
                    !message.transientKey &&
                    Number(message.planStep.step) === messageStep,
                );
        if (livePlanStep) {
          sessionMessagesById = {
            ...sessionMessagesById,
            [sessionId]: messages.map((message) =>
              message.id === livePlanStep.id
                ? { ...message, id: messageId, isComplete: false }
                : message,
            ),
          };
        } else {
          sessionMessagesById = {
            ...sessionMessagesById,
            [sessionId]: [
              ...messages,
              {
                id: messageId,
                role: "general",
                segments: [
                  {
                    type: "text",
                    text: "",
                    isStreaming: true,
                  },
                ],
                skillBadges: [],
                fileChanges: [],
                sdkProvider: event.sdkProvider || "",
                model: event.model || "",
                isComplete: false,
                timestamp: event.startedAt || new Date().toISOString(),
              },
            ],
          };
        }
      } else {
        // Reset isComplete so that parallel-session switching can
        // correctly identify this message as still in progress.
        sessionMessagesById = {
          ...sessionMessagesById,
          [sessionId]: messages.map((message) =>
            message.id === messageId
              ? {
                  ...message,
                  ...(event.sdkProvider ? { sdkProvider: event.sdkProvider } : {}),
                  ...(event.model ? { model: event.model } : {}),
                  isComplete: false,
                }
              : message
          ),
        };
      }
    }
    const startedMessages = sessionMessagesById[sessionId] || [];
    sessionMessagesById = {
      ...sessionMessagesById,
      [sessionId]: withoutWaitingResponseMessages(startedMessages),
    };
  } else if (isPlanTranscriptEvent(event.type)) {
    const nextMessages = messages.map((message) => {
      if (message.id !== messageId) return message;
      return applyPlanEventToMessage(message, event);
    });
    sessionMessagesById = {
      ...sessionMessagesById,
      [sessionId]: isLegacyFinalPlanStep(event)
        ? settleCompletedPlanToolCards(nextMessages)
        : nextMessages,
    };
  } else if (isTranscriptStreamEvent(event.type)) {
    let nextMessages = messages;
    if (
      (event.type === "step:start" || event.type === "step:end") &&
      messageId &&
      !messages.some((message) => message.id === messageId)
    ) {
      nextMessages = [
        ...messages,
        {
          id: messageId,
          role: "general",
          segments: [],
          skillBadges: [],
          fileChanges: [],
          isComplete: false,
          timestamp: event.startedAt || new Date().toISOString(),
        },
      ];
    }
    sessionMessagesById = {
      ...sessionMessagesById,
      [sessionId]: nextMessages.map((message) => {
        if (message.id !== messageId) return message;
        if (isCreatePlanToolEvent(event) || shouldNestStreamEventInPlan(message, event)) {
          return applyStreamEventToPlanRun(message, event, {
            stripText: stripPlanProgressText,
          });
        }
        return applyStreamEventToMessage(message, event, {
          stripText: stripPlanProgressText,
        });
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

function mergeSegmentTiming(processedSegments, uiSegments) {
  const persisted = Array.isArray(uiSegments) ? uiSegments : [];
  const nextIndexByType = new Map();
  let changed = false;

  const segments = (Array.isArray(processedSegments) ? processedSegments : []).map(
    (segment) => {
      if (!segment?.type || segment.type === "skill") return segment;
      const startIndex = nextIndexByType.get(segment.type) || 0;
      const uiIndex = persisted.findIndex(
        (candidate, index) => index >= startIndex && candidate?.type === segment.type,
      );
      if (uiIndex === -1) return segment;
      nextIndexByType.set(segment.type, uiIndex + 1);
      const uiSegment = persisted[uiIndex];

      if (segment.type === "tools") {
        const uiCards = new Map(
          (Array.isArray(uiSegment.cards) ? uiSegment.cards : [])
            .map((card) => [String(card?.id || ""), card])
            .filter(([id]) => id),
        );
        const cards = (Array.isArray(segment.cards) ? segment.cards : []).map((card) => {
          const uiCard = uiCards.get(String(card?.id || ""));
          if (!uiCard?.startedAt || card?.startedAt) return card;
          changed = true;
          return { ...card, startedAt: uiCard.startedAt };
        });
        return changed ? { ...segment, cards } : segment;
      }

      const timing = {};
      for (const key of ["startedAt", "endedAt", "durationMs"]) {
        if (segment[key] == null && uiSegment[key] != null) timing[key] = uiSegment[key];
      }
      if (!Object.keys(timing).length) return segment;
      changed = true;
      return { ...segment, ...timing };
    },
  );

  return changed ? segments : processedSegments;
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
    const segments = mergeSegmentTiming(
      mergeSkillSegments(message.segments, uiMessage.segments),
      uiMessage.segments,
    );
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
