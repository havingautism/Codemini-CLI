import {
  applyStreamEventToMessage,
  appendUniqueFileChanges,
  normalizeUsage,
} from "../../../shared/transcript-segments.js";
import { stripPlanProgressText } from "../../../shared/plan-progress-text.js";

const PLAN_NESTED_STREAM_EVENTS = new Set([
  "assistant:delta",
  "assistant:reasoning_delta",
  "assistant:response",
  "assistant:tool_call_delta",
  "tool:start",
  "tool:end",
  "tool:result",
  "tool:error",
  "tool:blocked",
]);

export function isCompletedStatus(status) {
  return ["done", "failed", "error", "blocked", "completed"].includes(
    String(status || "").toLowerCase(),
  );
}

export function isPlanOverviewComplete(message) {
  const steps = message?.planOverview?.steps;
  return (
    message?.role === "plan-overview" &&
    Array.isArray(steps) &&
    steps.length > 0 &&
    steps.every((step) => isCompletedStatus(step.status))
  );
}

export function isCreatePlanCard(card) {
  const name = String(card?.name || "")
    .toLowerCase()
    .replace(/\(.*$/, "");
  return name === "create_plan" || name === "run_subagent" || Boolean(card?.planRun);
}

export function planPhaseTitle(phase) {
  switch (String(phase || "").toLowerCase()) {
    case "planning":
      return "Subagent · 准备";
    case "executing":
      return "Subagent · 运行中";
    case "waiting":
      return "Subagent · 等待依赖";
    case "completed":
      return "Subagent · 完成";
    case "blocked":
      return "Subagent · 依赖阻塞";
    case "failed":
      return "Subagent · 失败";
    case "aborted":
      return "Subagent · 已中止";
    default:
      return "Subagent · 任务";
  }
}

export function createEmptyPlanRun({ goal = "", steps = [] } = {}) {
  return {
    phase: steps.length ? "executing" : "planning",
    goal: String(goal || "").trim(),
    steps: (Array.isArray(steps) ? steps : []).map((step, index) => ({
      index: Number(step.index ?? step.step ?? index + 1),
      role: step.role || "general",
      title: step.title || "",
      status: step.status || "pending",
      summary: step.summary || "",
      segments: Array.isArray(step.segments) ? step.segments : [],
      model: step.model || "",
      sdkProvider: step.sdkProvider || "",
      taskId: step.taskId || "",
      dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn : [],
      blockedBy: Array.isArray(step.blockedBy) ? step.blockedBy : [],
      ...(step.toolCallId ? { toolCallId: step.toolCallId } : {}),
    })),
  };
}

export function planRunFromTranscript(goal, transcript = []) {
  const blocks = Array.isArray(transcript) ? transcript : [];
  return createEmptyPlanRun({
    goal,
    steps: blocks.map((block, index) => ({
      index: block.step || index + 1,
      role: block.role || "general",
      title: block.title || "",
      status: block.status || "done",
      summary: block.summary || "",
      segments: Array.isArray(block.segments) ? block.segments : [],
    })),
  });
}

export function isPlanRunComplete(planRun) {
  const steps = planRun?.steps;
  return (
    Array.isArray(steps) &&
    steps.length > 0 &&
    steps.every((step) => isCompletedStatus(step.status))
  );
}

export function shouldExpandPlanStep(step, { userExpanded } = {}) {
  if (typeof userExpanded === "boolean") return userExpanded;
  const status = String(step?.status || "").toLowerCase();
  if (status === "running") return true;
  if (status === "failed") return true;
  return false;
}

function upsertCreatePlanCard(message, updater, { cardId = "" } = {}) {
  const targetId = String(cardId || "").trim();
  let found = false;
  const segments = [];
  for (const segment of Array.isArray(message?.segments) ? message.segments : []) {
    if (segment?.type !== "tools" || !Array.isArray(segment.cards)) {
      segments.push(segment);
      continue;
    }
    const cards = [];
    for (const card of segment.cards) {
      if (!isCreatePlanCard(card)) {
        cards.push(card);
        continue;
      }
      if (targetId) {
        if (String(card.id || "") !== targetId) {
          cards.push(card);
          continue;
        }
        found = true;
        cards.push(updater(card));
        continue;
      }
      // Legacy: no cardId → update the first plan/subagent card only.
      if (found) {
        cards.push(card);
        continue;
      }
      found = true;
      cards.push(updater(card));
    }
    if (cards.length) segments.push({ ...segment, cards });
  }
  if (!found) {
    const card = updater({
      id: targetId || `run_subagent-${Date.now()}`,
      name: "run_subagent",
      status: "running",
      arguments: {},
    });
    return {
      ...message,
      segments: [...segments, { type: "tools", cards: [card] }],
    };
  }
  return { ...message, segments };
}

export function findCreatePlanCard(message, cardId = "") {
  const targetId = String(cardId || "").trim();
  for (const segment of Array.isArray(message?.segments) ? message.segments : []) {
    if (segment?.type !== "tools") continue;
    for (const card of segment.cards || []) {
      if (!isCreatePlanCard(card)) continue;
      if (targetId && String(card.id || "") !== targetId) continue;
      return card;
    }
  }
  return null;
}

export function listCreatePlanCards(message) {
  const cards = [];
  for (const segment of Array.isArray(message?.segments) ? message.segments : []) {
    if (segment?.type !== "tools") continue;
    for (const card of segment.cards || []) {
      if (isCreatePlanCard(card)) cards.push(card);
    }
  }
  return cards;
}

export function messageHasActivePlanRun(message) {
  return listCreatePlanCards(message).some((card) => {
    if (String(card.status || "").toLowerCase() === "running") return true;
    const phase = String(card?.planRun?.phase || "").toLowerCase();
    return phase === "planning" || phase === "executing";
  });
}

export function findActivePlanParentMessage(messages = []) {
  return [...(Array.isArray(messages) ? messages : [])]
    .reverse()
    .find((message) => messageHasActivePlanRun(message));
}

export function shouldNestStreamEventInPlan(message, event) {
  if (!messageHasActivePlanRun(message)) return false;
  if (!PLAN_NESTED_STREAM_EVENTS.has(String(event?.type || ""))) return false;
  if (isCreatePlanToolEvent(event)) return false;

  const parentToolCallId = String(event?.parentToolCallId || "").trim();
  if (parentToolCallId) {
    return Boolean(findCreatePlanCard(message, parentToolCallId)?.planRun?.steps?.length);
  }

  const card = findCreatePlanCard(message);
  const cardName = String(card?.name || "").toLowerCase().replace(/\(.*$/, "");
  if (cardName === "run_subagent") return false;

  if (
    event.type === "assistant:delta" ||
    event.type === "assistant:reasoning_delta" ||
    event.type === "assistant:response"
  ) {
    return (card?.planRun?.steps || []).some(
      (step) => String(step?.status || "").toLowerCase() === "running",
    );
  }

  return Boolean(card?.planRun?.steps?.length);
}

export function isCreatePlanToolEvent(event) {
  const name = String(event?.name || event?.toolName || event?.toolCall?.name || "")
    .toLowerCase()
    .replace(/\(.*$/, "");
  return name === "create_plan" || name === "run_subagent";
}

/** Apply assistant/tool stream events into the currently running plan step. */
export function applyStreamEventToPlanRun(message, event, options = {}) {
  if (!message || !event?.type) return message;
  if (isCreatePlanToolEvent(event)) {
    const cardId = String(event.id || event.toolCall?.id || event.toolCallId || "").trim();
    return upsertCreatePlanCard(
      message,
      (card) => {
        const type = String(event.type);
        if (type === "assistant:tool_call_delta" || type === "tool:start") {
          return {
            ...card,
            id: cardId || card.id,
            name: event.name || event.toolCall?.name || card.name || "run_subagent",
            displayName:
              event.displayName ||
              card.displayName ||
              planPhaseTitle("executing") ||
              options.formatToolLabel?.("run_subagent"),
            arguments:
              event.arguments ||
              event.toolCall?.arguments ||
              card.arguments ||
              {},
            status: "running",
            summary: event.summary || card.summary || "",
            planRun: card.planRun || createEmptyPlanRun(),
          };
        }
        if (type === "tool:result") {
          return {
            ...card,
            result: event.content || card.result || "",
            planRun: card.planRun,
          };
        }
        if (type === "tool:blocked") {
          return {
            ...card,
            status: "blocked",
            summary: event.summary || card.summary || "Tool blocked",
            planRun: card.planRun
              ? { ...card.planRun, phase: "aborted" }
              : card.planRun,
            displayName: planPhaseTitle("aborted"),
          };
        }
        if (type === "tool:error") {
          return {
            ...card,
            status: "error",
            durationMs: event.durationMs,
            summary: event.summary || card.summary,
            planRun: card.planRun
              ? { ...card.planRun, phase: "failed" }
              : card.planRun,
            displayName: planPhaseTitle("failed"),
          };
        }
        if (type === "tool:end") {
          const complete = isPlanRunComplete(card.planRun);
          const planRun = card.planRun
            ? {
                ...card.planRun,
                phase:
                  card.planRun.phase === "failed" ||
                  card.planRun.phase === "aborted" ||
                  card.planRun.phase === "blocked"
                    ? card.planRun.phase
                    : complete
                      ? "completed"
                      : card.planRun.phase || "completed",
              }
            : card.planRun;
          const anyFailed = (planRun?.steps || []).some(
            (step) => String(step.status || "").toLowerCase() === "failed",
          );
          return {
            ...card,
            status:
              planRun?.phase === "failed" || anyFailed
                ? "error"
                : planRun?.phase === "blocked"
                  ? "blocked"
                : planRun?.phase === "aborted"
                  ? "done"
                  : "done",
            durationMs: event.durationMs,
            ...(event.summary ? { summary: event.summary } : {}),
            planRun,
            displayName: planPhaseTitle(planRun?.phase || "completed"),
          };
        }
        return card;
      },
      { cardId },
    );
  }

  if (!messageHasActivePlanRun(message)) return message;

  const cardId = String(event.parentToolCallId || event.toolCallId || "").trim();
  let nestedFileChanges = [];
  const next = upsertCreatePlanCard(
    message,
    (card) => {
      const planRun = card.planRun;
      if (!planRun?.steps?.length) return card;
      const steps = planRun.steps.map((step) => ({ ...step }));
      let stepIndex = -1;
      if (cardId) {
        stepIndex = steps.findIndex(
          (step) => String(step.toolCallId || "") === cardId,
        );
      }
      if (stepIndex < 0) {
        stepIndex = steps.findIndex(
          (step) => String(step.status || "").toLowerCase() === "running",
        );
      }
      if (stepIndex < 0) return card;
      const step = steps[stepIndex];
      const pseudo = applyStreamEventToMessage(
        { segments: Array.isArray(step.segments) ? step.segments : [], fileChanges: [] },
        event,
        {
          stripText: stripPlanProgressText,
          ...options,
        },
      );
      nestedFileChanges = Array.isArray(pseudo.fileChanges) ? pseudo.fileChanges : [];
      steps[stepIndex] = {
        ...step,
        segments: Array.isArray(pseudo.segments) ? pseudo.segments : [],
      };
      return {
        ...card,
        planRun: { ...planRun, steps },
      };
    },
    { cardId },
  );
  if (!nestedFileChanges.length) return next;
  return {
    ...next,
    fileChanges: appendUniqueFileChanges(next.fileChanges, nestedFileChanges),
  };
}

export function appendPlanRunStreamingText(message, text) {
  const chunk = stripPlanProgressText(text);
  if (!chunk || !message) return message;
  return applyStreamEventToPlanRun(message, {
    type: "assistant:delta",
    text: chunk,
  });
}

export function applyPlanEventToMessage(message, event) {
  if (!message || !event?.type) return message;
  const type = String(event.type);
  const cardId = String(event.toolCallId || event.parentToolCallId || "").trim();

  if (type === "plan:steps") {
    const planRun = createEmptyPlanRun({
      goal: event.goal || "",
      steps: (event.steps || []).map((step, index) => ({
        index: step.index ?? index + 1,
        role: step.role,
        title: step.title,
        status: step.status || "pending",
        toolCallId: step.toolCallId || cardId || "",
      })),
    });
    planRun.phase = "executing";
    return upsertCreatePlanCard(
      message,
      (card) => ({
        ...card,
        status: "running",
        displayName: planPhaseTitle("executing"),
        planRun: {
          ...planRun,
          goal:
            planRun.goal ||
            String(card.arguments?.goal || card.arguments?.prompt || card.summary || "").trim(),
        },
      }),
      { cardId },
    );
  }

  if (type === "plan:step_start" || type === "plan:progress" || type === "plan:step_done") {
    // Prefer toolCallId targeting (one card per run_subagent). Fall back to step index.
    const stepNumber = Number(event.step);
    const hasStepNumber = Number.isFinite(stepNumber) && stepNumber >= 1;
    if (!cardId && !hasStepNumber) return message;

    return upsertCreatePlanCard(
      message,
      (card) => {
        const current = card.planRun || createEmptyPlanRun({ goal: event.goal || "" });
        const steps = [...(current.steps || [])];
        let stepIndex = -1;
        if (cardId) {
          stepIndex = steps.findIndex((step) => String(step.toolCallId || "") === cardId);
        }
        if (stepIndex < 0 && hasStepNumber) {
          while (steps.length < stepNumber) {
            steps.push({
              index: steps.length + 1,
              role: "general",
              title: "",
              status: "pending",
              summary: "",
              segments: [],
            });
          }
          stepIndex = stepNumber - 1;
        }
        if (stepIndex < 0) {
          steps.push({
            index: steps.length + 1,
            role: event.role || "general",
            title: event.title || "",
            status: "pending",
            summary: "",
            segments: [],
            toolCallId: cardId,
          });
          stepIndex = steps.length - 1;
        }

        const existing = steps[stepIndex] || {
          index: stepIndex + 1,
          role: "general",
          title: "",
          status: "pending",
          summary: "",
          segments: [],
        };
        const status =
          event.status ||
          (type === "plan:step_start"
            ? "running"
            : type === "plan:step_done"
              ? "done"
              : existing.status);
        const outputText = String(event.output || "").trim();
        let segments = Array.isArray(existing.segments) ? [...existing.segments] : [];
        if (type === "plan:step_done" && outputText) {
          const already = segments.some(
            (segment) =>
              (segment.type === "text" || segment.type === "handoff") &&
              String(segment.text || "").trim() === outputText,
          );
          if (!already) {
            segments = [
              ...segments,
              {
                type:
                  String(event.role || existing.role || "").toLowerCase() ===
                  "summarizer"
                    ? "text"
                    : "handoff",
                text: outputText,
                isStreaming: false,
              },
            ];
          }
        }
        steps[stepIndex] = {
          ...existing,
          index: existing.index || stepIndex + 1,
          role: event.role || existing.role,
          title: event.title || existing.title,
          status,
          summary: event.summary ?? existing.summary,
          model: event.model || existing.model,
          sdkProvider: event.sdkProvider || existing.sdkProvider,
          taskId: event.taskId || existing.taskId || "",
          dependsOn: Array.isArray(event.dependsOn)
            ? event.dependsOn
            : existing.dependsOn || [],
          blockedBy: Array.isArray(event.blockedBy)
            ? event.blockedBy
            : existing.blockedBy || [],
          usage: normalizeUsage(event.usage) || existing.usage || null,
          toolCallId: cardId || existing.toolCallId || "",
          segments,
        };

        const allDone = steps.length > 0 && steps.every((step) => isCompletedStatus(step.status));
        const anyFailed = steps.some(
          (step) => String(step.status || "").toLowerCase() === "failed",
        );
        const anyBlocked = steps.some(
          (step) => String(step.status || "").toLowerCase() === "blocked",
        );
        const anyWaiting = steps.some(
          (step) => String(step.status || "").toLowerCase() === "waiting",
        );
        const phase = allDone
          ? anyFailed
            ? "failed"
            : anyBlocked
              ? "blocked"
              : "completed"
          : anyWaiting
            ? "waiting"
            : "executing";

        return {
          ...card,
          status: allDone
            ? anyFailed
              ? "error"
              : anyBlocked
                ? "blocked"
                : "done"
            : "running",
          displayName: planPhaseTitle(phase),
          planRun: {
            ...current,
            phase,
            goal:
              event.goal ||
              current.goal ||
              String(card.arguments?.goal || card.arguments?.prompt || "").trim(),
            steps,
          },
        };
      },
      { cardId },
    );
  }

  return message;
}

export function settleRunningCreatePlanCards(message, { reason = "aborted" } = {}) {
  let changed = false;
  const terminalPhase =
    reason === "completed"
      ? "completed"
      : reason === "failed"
        ? "failed"
        : "aborted";
  const settleStatus = terminalPhase === "completed" ? "done" : "failed";
  const segments = (Array.isArray(message?.segments) ? message.segments : []).map(
    (seg) => {
      if (seg?.type !== "tools" || !Array.isArray(seg.cards)) return seg;
      let cardsChanged = false;
      const cards = seg.cards.map((card) => {
        if (!isCreatePlanCard(card)) return card;
        const currentPhase = String(card?.planRun?.phase || "").toLowerCase();
        const isActive =
          String(card.status || "").toLowerCase() === "running" ||
          currentPhase === "planning" ||
          currentPhase === "executing";
        if (!isActive) return card;
        cardsChanged = true;
        const currentRun = card.planRun;
        const steps = Array.isArray(currentRun?.steps)
          ? currentRun.steps.map((step) => {
              const status = String(step?.status || "").toLowerCase();
              if (isCompletedStatus(status)) return step;
              const stepSegments = (Array.isArray(step.segments) ? step.segments : []).map(
                (segment) => {
                  if (segment?.type === "thinking" && segment.isStreaming) {
                    return { ...segment, isStreaming: false };
                  }
                  if (segment?.type !== "tools" || !Array.isArray(segment.cards)) {
                    return segment;
                  }
                  return {
                    ...segment,
                    cards: segment.cards.map((toolCard) =>
                      toolCard?.status === "running"
                        ? {
                            ...toolCard,
                            status: terminalPhase === "completed" ? "done" : "error",
                            summary:
                              toolCard.summary ||
                              (terminalPhase === "failed"
                                ? "Failed"
                                : terminalPhase === "aborted"
                                  ? "Aborted"
                                  : ""),
                          }
                        : toolCard,
                    ),
                  };
                },
              );
              return {
                ...step,
                status: settleStatus,
                summary:
                  step.summary ||
                  (terminalPhase === "failed"
                    ? "Failed"
                    : terminalPhase === "aborted"
                      ? "Aborted"
                      : ""),
                segments: stepSegments,
              };
            })
          : currentRun?.steps;
        const planRun = currentRun
          ? {
              ...currentRun,
              phase:
                currentRun.phase === "failed" || currentRun.phase === "aborted"
                  ? currentRun.phase
                  : terminalPhase,
              steps,
            }
          : currentRun;
        return {
          ...card,
          status: planRun?.phase === "failed" ? "error" : "done",
          displayName: planPhaseTitle(planRun?.phase || terminalPhase),
          planRun,
        };
      });
      if (!cardsChanged) return seg;
      changed = true;
      return { ...seg, cards };
    },
  );
  return changed ? { ...message, segments } : message;
}

function reconcileDuplicatedPlanToolCards(message) {
  const topLevelIds = new Set();
  for (const segment of Array.isArray(message?.segments) ? message.segments : []) {
    if (segment?.type !== "tools") continue;
    for (const card of segment.cards || []) {
      if (!isCreatePlanCard(card) && card?.id) topLevelIds.add(String(card.id));
    }
  }
  if (!topLevelIds.size) return message;

  const nestedCardsById = new Map();
  const segments = (message.segments || []).map((segment) => {
    if (segment?.type !== "tools" || !Array.isArray(segment.cards)) return segment;
    return {
      ...segment,
      cards: segment.cards.map((card) => {
        if (!isCreatePlanCard(card) || !card?.planRun?.steps) return card;
        const steps = card.planRun.steps.map((step) => ({
          ...step,
          segments: (step.segments || []).flatMap((stepSegment) => {
            if (stepSegment?.type !== "tools" || !Array.isArray(stepSegment.cards)) {
              return [stepSegment];
            }
            const cards = stepSegment.cards.filter((nestedCard) => {
              const id = String(nestedCard?.id || "");
              if (!id || !topLevelIds.has(id)) return true;
              nestedCardsById.set(id, nestedCard);
              return false;
            });
            return cards.length ? [{ ...stepSegment, cards }] : [];
          }),
        }));
        return { ...card, planRun: { ...card.planRun, steps } };
      }),
    };
  });
  if (!nestedCardsById.size) return message;

  return {
    ...message,
    segments: segments.map((segment) => {
      if (segment?.type !== "tools" || !Array.isArray(segment.cards)) return segment;
      return {
        ...segment,
        cards: segment.cards.map((card) => {
          if (isCreatePlanCard(card)) return card;
          const nestedCard = nestedCardsById.get(String(card?.id || ""));
          return nestedCard ? { ...card, ...nestedCard } : card;
        }),
      };
    }),
  };
}

export function settleCompletedPlanToolCards(messages) {
  const list = Array.isArray(messages) ? messages : [];
  if (!list.length) return list;

  return list.map((message) => {
    const card = findCreatePlanCard(message);
    if (card?.planRun && isPlanRunComplete(card.planRun)) {
      return reconcileDuplicatedPlanToolCards(
        settleRunningCreatePlanCards(message, { reason: "completed" }),
      );
    }
    if (isPlanOverviewComplete(message)) {
      // Legacy overview path kept for old transcripts.
      return message;
    }
    // Legacy: settle parent cards preceding a completed overview message.
    return message;
  }).map((message, index, nextList) => {
    // Preserve previous overview-based settle for legacy sessions.
    const completedOverviewIndexes = nextList
      .map((candidate, candidateIndex) =>
        isPlanOverviewComplete(candidate) ? candidateIndex : -1,
      )
      .filter((candidateIndex) => candidateIndex >= 0);
    if (!completedOverviewIndexes.length) return message;
    const ownedByCompletedOverview = completedOverviewIndexes.some(
      (overviewIndex) => {
        if (index >= overviewIndex) return false;
        const laterOverview = nextList.findIndex(
          (candidate, candidateIndex) =>
            candidateIndex > index &&
            candidateIndex < overviewIndex &&
            candidate?.role === "plan-overview",
        );
        return laterOverview === -1;
      },
    );
    if (!ownedByCompletedOverview) return message;
    return settleRunningCreatePlanCards(message, { reason: "completed" });
  });
}

export function findPlanStepMessageId(messages, overviewId, step) {
  const list = Array.isArray(messages) ? messages : [];
  const overviewIndex = overviewId
    ? list.findIndex((message) => message?.id === overviewId)
    : -1;
  const scope =
    overviewIndex >= 0 ? list.slice(overviewIndex + 1) : [...list].reverse();
  const match = scope.find(
    (message) => Number(message?.planStep?.step) === Number(step),
  );
  return match?.id || null;
}

export function updatePlanOverviewStepStatus(message, step, status) {
  if (!message?.planOverview || !status) return message;
  return {
    ...message,
    planOverview: {
      ...message.planOverview,
      steps: message.planOverview.steps.map((entry, index) =>
        index === step - 1 ? { ...entry, status } : entry,
      ),
    },
  };
}
