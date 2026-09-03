import {
  applyStreamEventToMessage,
  isTranscriptStreamEvent,
  routingGraphFromEvent,
  memoryInjectFromEvent,
} from "../../../shared/transcript-segments.js";
import { stripPlanProgressText } from "../../../shared/plan-progress-text.js";
import {
  applyPlanEventToMessage,
  applyStreamEventToPlanRun,
  findActivePlanParentMessage,
  findCreatePlanCard,
  findMessageOwningPlanCard,
  isCreatePlanToolEvent,
  isLegacyFinalPlanStep,
  isPlanTranscriptEvent,
  shouldNestStreamEventInPlan,
  settleCompletedPlanToolCards,
} from "./plan-ui-state.js";
import { sessionRuntimeIsBusy } from "./session-ui-state.js";
import {
  isTowerBackgroundWorkerToolEvent,
  sanitizeTowerMessageFileChanges,
  settleLingeringTowerDispatchCards,
  settleTowerReviewDispatchCards,
} from "./tower-ui-state.js";
import { parseTowerReviewCompletedWake } from "../../../../src/core/tower-snapshot.js";

function sessionTowerActive(state, sessionId) {
  const runtime = state.runtimeState || {};
  if (String(runtime.sessionId || "") === sessionId) {
    return Boolean(runtime.towerActive);
  }
  return Boolean(state.sessionRuntimeById?.[sessionId]?.towerActive);
}

const SESSION_SCOPED_RUNTIME_KEYS = new Set([
  "sessionId",
  "busy",
  "status",
  "queuePosition",
  "pendingApproval",
  "pendingApprovals",
  "pendingUserInput",
  "pendingSpecApproval",
  "pendingReflectSkill",
  "requestInFlight",
  "needsAttention",
  "parallelWriteRisk",
]);

const KEEP_PENDING_APPROVAL_STATUSES = new Set([
  "queued",
  "running",
  "waiting",
  "waiting_approval",
  "waiting_input",
]);

function approvalId(value) {
  return String(value?.id || "").trim();
}

function normalizeApprovalQueue(runtime = {}) {
  const queued = Array.isArray(runtime?.pendingApprovals)
    ? runtime.pendingApprovals.filter((item) => approvalId(item))
    : [];
  if (queued.length) return queued;
  const single = runtime?.pendingApproval;
  return approvalId(single) ? [single] : [];
}

function upsertApprovalQueue(queue, event) {
  const id = approvalId(event);
  if (!id) return queue;
  const index = queue.findIndex((item) => approvalId(item) === id);
  if (index >= 0) {
    const next = queue.slice();
    next[index] = event;
    return next;
  }
  return [...queue, event];
}

function removeApprovalFromQueue(queue, id) {
  const requestId = String(id || "").trim();
  if (!requestId) return queue;
  return queue.filter((item) => approvalId(item) !== requestId);
}

function withApprovalQueue(runtime, queue) {
  const next = Array.isArray(queue) ? queue : [];
  return {
    ...runtime,
    pendingApprovals: next,
    pendingApproval: next[0] || null,
  };
}

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
    const merged = {
      ...previous,
      ...(event.state || {}),
      sessionId,
    };
    const queue = normalizeApprovalQueue(previous);
    runtime = KEEP_PENDING_APPROVAL_STATUSES.has(event.state?.status)
      ? withApprovalQueue(merged, queue)
      : withApprovalQueue(merged, []);
    if (previous.pendingUserInput && event.state?.status !== "waiting_input") {
      runtime = { ...runtime, pendingUserInput: null };
    }
  } else if (event.type === "approval:request") {
    runtime = withApprovalQueue(
      { ...previous, sessionId },
      upsertApprovalQueue(normalizeApprovalQueue(previous), event),
    );
  } else if (event.type === "approval:resolved") {
    runtime = withApprovalQueue(
      { ...previous, sessionId },
      removeApprovalFromQueue(normalizeApprovalQueue(previous), event.id),
    );
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
    if (event.result?.aborted === true || event.result?.type === "aborted") {
      // An abort means the agent behind any pending approval/user-input is
      // gone, so the interaction dialog must close or the session stays stuck
      // on the "waiting" state even though no turn is running.
      runtime = {
        ...previous,
        status: "aborted",
        busy: false,
        pendingApproval: null,
        pendingApprovals: [],
        pendingUserInput: null,
        sessionId,
      };
    } else if (previous.pendingApproval || previous.pendingApprovals?.length || previous.pendingUserInput) {
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
        pendingApprovals: [],
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

function findTowerWorkerOwnerMessage(messages, event) {
  const parentId = String(event?.parentToolCallId || "").trim();
  if (!parentId) return null;
  return (Array.isArray(messages) ? messages : []).find((message) =>
    findCreatePlanCard(message, parentId),
  );
}

export function reduceSessionTranscriptEvent(state, event) {
  const sessionId = String(event?.sessionId || "").trim();
  if (!sessionId) return state;

  let sessionMessagesById = state.sessionMessagesById;
  const messages = state.sessionMessagesById[sessionId] || [];
  if (event.type === "tower:wake") {
    const headline = String(event.headline || event.text || "").trim();
    if (!headline) return state;
    const wakeId = String(event.messageId || "").trim() || `tower-wake-${Date.now()}`;
    if (messages.some((message) => message.id === wakeId)) return state;
    const reviewOf = parseTowerReviewCompletedWake(headline);
    const nextMessages = reviewOf
      ? settleTowerReviewDispatchCards(messages, reviewOf)
      : messages;
    return {
      ...state,
      sessionMessagesById: {
        ...sessionMessagesById,
        [sessionId]: [
          ...nextMessages,
          {
            id: wakeId,
            role: "divider",
            dividerType: "tower-wake",
            text: headline,
            segments: [{ type: "text", text: headline, isStreaming: false }],
            skillBadges: [],
            fileChanges: [],
            isComplete: true,
            timestamp: event.timestamp || new Date().toISOString(),
          },
        ],
      },
    };
  }
  const towerActive = sessionTowerActive(state, sessionId);
  const planOwner = isPlanTranscriptEvent(event.type)
    ? findMessageOwningPlanCard(messages, event.toolCallId)
    : null;
  const workerOwner = isTowerBackgroundWorkerToolEvent(event, { towerActive })
    ? findTowerWorkerOwnerMessage(messages, event)
    : null;
  if (
    isTowerBackgroundWorkerToolEvent(event, { towerActive }) &&
    !workerOwner
  ) {
    return state;
  }
  const activePlanParent = findActivePlanParentMessage(messages);
  const messageId = (() => {
    if (planOwner?.id) return planOwner.id;
    if (workerOwner?.id) return workerOwner.id;
    if (event.type === "routing:graph" || event.type === "memory:retrieved") {
      const requested = String(event.messageId || "").trim();
      const userMessage = requested
        ? messages.find(
            (message) => message?.id === requested && message?.role === "you",
          )
        : [...messages].reverse().find((message) => message?.role === "you");
      if (userMessage?.id) return userMessage.id;
    }
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
  if (event.type === "routing:graph") {
    sessionMessagesById = {
      ...sessionMessagesById,
      [sessionId]: messages.map((message) =>
        message.id === messageId
          ? { ...message, routingGraph: routingGraphFromEvent(event) }
          : message,
      ),
    };
  } else if (event.type === "memory:retrieved") {
    sessionMessagesById = {
      ...sessionMessagesById,
      [sessionId]: messages.map((message) =>
        message.id === messageId
          ? { ...message, memoryInject: memoryInjectFromEvent(event, message.memoryInject) }
          : message,
      ),
    };
  } else if (event.type === "assistant:start") {
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
        const towerActive = sessionTowerActive(state, sessionId);
        let nextMessage = message;
        if (isCreatePlanToolEvent(event) || shouldNestStreamEventInPlan(message, event)) {
          nextMessage = applyStreamEventToPlanRun(message, event, {
            stripText: stripPlanProgressText,
          });
        } else {
          nextMessage = applyStreamEventToMessage(message, event, {
            stripText: stripPlanProgressText,
          });
        }
        if (
          towerActive &&
          (isTowerBackgroundWorkerToolEvent(event, { towerActive }) ||
            event.type === "tool:end")
        ) {
          nextMessage = sanitizeTowerMessageFileChanges(nextMessage, {
            towerActive,
          });
        }
        return nextMessage;
      }),
    };
    if (
      towerActive &&
      (event.type === "tool:end" || event.type === "tool:result") &&
      String(event.name || event.toolName || "").toLowerCase().replace(/\(.*$/, "") === "land_workers"
    ) {
      sessionMessagesById = {
        ...sessionMessagesById,
        [sessionId]: settleLingeringTowerDispatchCards(
          sessionMessagesById[sessionId] || [],
        ),
      };
    }
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
