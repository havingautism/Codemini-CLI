import { applyStreamEventToMessage } from "../../../shared/transcript-segments.js";
import { stripPlanProgressText } from "../../../shared/plan-progress-text.js";

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
  return name === "create_plan" || Boolean(card?.planRun);
}

export function planPhaseTitle(phase) {
  switch (String(phase || "").toLowerCase()) {
    case "planning":
      return "Plan · 规划";
    case "executing":
      return "Plan · 执行";
    case "completed":
      return "Plan · 完成";
    case "failed":
      return "Plan · 失败";
    case "aborted":
      return "Plan · 已中止";
    default:
      return "Plan · 规划/执行";
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

function upsertCreatePlanCard(message, updater) {
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
      // Keep a single create_plan card per message; drop duplicates.
      if (found) continue;
      found = true;
      cards.push(updater(card));
    }
    if (cards.length) segments.push({ ...segment, cards });
  }
  if (!found) {
    const card = updater({
      id: `create_plan-${Date.now()}`,
      name: "create_plan",
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

export function findCreatePlanCard(message) {
  for (const segment of Array.isArray(message?.segments) ? message.segments : []) {
    if (segment?.type !== "tools") continue;
    const card = (segment.cards || []).find(isCreatePlanCard);
    if (card) return card;
  }
  return null;
}

export function messageHasActivePlanRun(message) {
  const card = findCreatePlanCard(message);
  if (!card) return false;
  if (String(card.status || "").toLowerCase() === "running") return true;
  const phase = String(card?.planRun?.phase || "").toLowerCase();
  return phase === "planning" || phase === "executing";
}

export function findActivePlanParentMessage(messages = []) {
  return [...(Array.isArray(messages) ? messages : [])]
    .reverse()
    .find((message) => messageHasActivePlanRun(message));
}

export function isCreatePlanToolEvent(event) {
  const name = String(event?.name || event?.toolName || event?.toolCall?.name || "")
    .toLowerCase()
    .replace(/\(.*$/, "");
  return name === "create_plan";
}

/** Apply assistant/tool stream events into the currently running plan step. */
export function applyStreamEventToPlanRun(message, event, options = {}) {
  if (!message || !event?.type) return message;
  if (isCreatePlanToolEvent(event)) {
    return upsertCreatePlanCard(message, (card) => {
      const type = String(event.type);
      if (type === "assistant:tool_call_delta" || type === "tool:start") {
        return {
          ...card,
          id: event.id || event.toolCall?.id || card.id,
          name: event.name || event.toolCall?.name || card.name || "create_plan",
          displayName:
            event.displayName || card.displayName || options.formatToolLabel?.("create_plan"),
          arguments:
            event.arguments ||
            event.toolCall?.arguments ||
            card.arguments ||
            {},
          status: "running",
          summary: event.summary || card.summary || "",
          planRun: card.planRun,
        };
      }
      if (type === "tool:result") {
        return {
          ...card,
          id: event.id || card.id,
          result: event.content || card.result || "",
          planRun: card.planRun,
        };
      }
      if (type === "tool:blocked") {
        return {
          ...card,
          id: event.id || card.id,
          status: "blocked",
          summary: event.summary || card.summary || "Tool blocked",
          planRun: card.planRun
            ? { ...card.planRun, phase: "aborted" }
            : card.planRun,
          displayName: planPhaseTitle(card.planRun?.phase || "aborted"),
        };
      }
      if (type === "tool:error") {
        return {
          ...card,
          id: event.id || card.id,
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
        const planRun = card.planRun
          ? {
              ...card.planRun,
              phase:
                card.planRun.phase === "failed" || card.planRun.phase === "aborted"
                  ? card.planRun.phase
                  : isPlanRunComplete(card.planRun)
                    ? "completed"
                    : card.planRun.phase || "completed",
            }
          : card.planRun;
        return {
          ...card,
          id: event.id || card.id,
          status:
            planRun?.phase === "failed"
              ? "error"
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
    });
  }

  if (!messageHasActivePlanRun(message)) return message;

  return upsertCreatePlanCard(message, (card) => {
    const planRun = card.planRun;
    if (!planRun?.steps?.length) return card;
    const steps = planRun.steps.map((step) => ({ ...step }));
    const runningIndex = steps.findIndex(
      (step) => String(step.status || "").toLowerCase() === "running",
    );
    if (runningIndex < 0) return card;
    const step = steps[runningIndex];
    const pseudo = applyStreamEventToMessage(
      { segments: Array.isArray(step.segments) ? step.segments : [] },
      event,
      {
        stripText: stripPlanProgressText,
        ...options,
      },
    );
    steps[runningIndex] = {
      ...step,
      segments: Array.isArray(pseudo.segments) ? pseudo.segments : [],
    };
    return {
      ...card,
      planRun: { ...planRun, steps },
    };
  });
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

  if (type === "plan:steps") {
    const planRun = createEmptyPlanRun({
      goal: event.goal || "",
      steps: (event.steps || []).map((step, index) => ({
        index: step.index ?? index + 1,
        role: step.role,
        title: step.title,
        status: step.status || "pending",
      })),
    });
    planRun.phase = "executing";
    return upsertCreatePlanCard(message, (card) => ({
      ...card,
      status: "running",
      displayName: planPhaseTitle("executing"),
      planRun: {
        ...planRun,
        goal:
          planRun.goal ||
          String(card.arguments?.goal || card.summary || "").trim(),
      },
    }));
  }

  if (type === "plan:step_start" || type === "plan:progress" || type === "plan:step_done") {
    const stepNumber = Number(event.step);
    if (!Number.isFinite(stepNumber) || stepNumber < 1) return message;
    return upsertCreatePlanCard(message, (card) => {
      const current = card.planRun || createEmptyPlanRun();
      const steps = [...(current.steps || [])];
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
      const existing = steps[stepNumber - 1] || {
        index: stepNumber,
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
      steps[stepNumber - 1] = {
        ...existing,
        index: stepNumber,
        role: event.role || existing.role,
        title: event.title || existing.title,
        status,
        summary: event.summary ?? existing.summary,
        model: event.model || existing.model,
        sdkProvider: event.sdkProvider || existing.sdkProvider,
        segments,
      };

      const allDone = steps.length > 0 && steps.every((step) => isCompletedStatus(step.status));
      const anyFailed = steps.some(
        (step) => String(step.status || "").toLowerCase() === "failed",
      );
      const phase = allDone
        ? anyFailed
          ? "failed"
          : "completed"
        : "executing";

      return {
        ...card,
        status: allDone ? (anyFailed ? "error" : "done") : "running",
        displayName: planPhaseTitle(phase),
        planRun: {
          ...current,
          phase,
          steps,
        },
      };
    });
  }

  return message;
}

export function settleRunningCreatePlanCards(message, { reason = "aborted" } = {}) {
  let changed = false;
  const settleStatus = reason === "failed" ? "failed" : "aborted";
  const segments = (Array.isArray(message?.segments) ? message.segments : []).map(
    (seg) => {
      if (seg?.type !== "tools" || !Array.isArray(seg.cards)) return seg;
      let cardsChanged = false;
      const cards = seg.cards.map((card) => {
        if (!isCreatePlanCard(card) || card.status !== "running") return card;
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
                            status: "error",
                            summary: toolCard.summary || "Aborted",
                          }
                        : toolCard,
                    ),
                  };
                },
              );
              return {
                ...step,
                status: settleStatus === "failed" ? "failed" : "failed",
                summary: step.summary || "Aborted",
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
                  : "aborted",
              steps,
            }
          : currentRun;
        return {
          ...card,
          status: planRun?.phase === "failed" ? "error" : "done",
          displayName: planPhaseTitle(planRun?.phase || "aborted"),
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

export function settleCompletedPlanToolCards(messages) {
  const list = Array.isArray(messages) ? messages : [];
  if (!list.length) return list;

  return list.map((message) => {
    const card = findCreatePlanCard(message);
    if (card?.planRun && isPlanRunComplete(card.planRun)) {
      return settleRunningCreatePlanCards(message);
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
    return settleRunningCreatePlanCards(message);
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
