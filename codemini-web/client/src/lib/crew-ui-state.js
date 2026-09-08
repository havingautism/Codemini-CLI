import { describeCrewRunSubagent } from "../../../../src/core/tool-display.js";
import { settleRunningCreatePlanCards } from "./plan-ui-state.js";

function* iterateToolCards(segments = []) {
  for (const segment of Array.isArray(segments) ? segments : []) {
    if (segment?.type !== "tools" || !Array.isArray(segment.cards)) continue;
    for (const card of segment.cards) {
      yield card;
      const steps = Array.isArray(card?.planRun?.steps) ? card.planRun.steps : [];
      for (const step of steps) {
        yield* iterateToolCards(step.segments);
      }
    }
  }
}

function normalizeToolName(name = "") {
  return String(name || "")
    .toLowerCase()
    .replace(/\(.*$/, "");
}

export function messageHasCrewDispatchCards(message) {
  for (const card of iterateToolCards(message?.segments)) {
    if (normalizeToolName(card?.name) !== "run_subagent") continue;
    if (describeCrewRunSubagent(card?.arguments || {})) return true;
  }
  return false;
}

export function messageHasLandWorkersTool(message) {
  for (const card of iterateToolCards(message?.segments)) {
    if (normalizeToolName(card?.name) !== "land_workers") continue;
    if (String(card?.status || "").toLowerCase() === "done") return true;
  }
  return false;
}

/** Crew parent should not mirror worker worktree edits on dispatch/status bubbles. */
export function shouldShowCrewModeFileChanges(message, { crewActive } = {}) {
  if (!crewActive) return true;
  if (messageHasLandWorkersTool(message)) return true;
  if (messageHasCrewDispatchCards(message)) return false;
  return false;
}

/** Agent todo panels are misleading in crew mode — workers run asynchronously. */
export function shouldSuppressCrewTaskTodos({ crewActive } = {}) {
  return Boolean(crewActive);
}

/** Nested worker tools (not the parent spawn/review card) belong on the owner card. */
export function isCrewBackgroundWorkerToolEvent(event, { crewActive } = {}) {
  if (!crewActive || !event) return false;
  return Boolean(String(event.parentToolCallId || "").trim());
}

function isCrewDispatchCard(card) {
  return normalizeToolName(card?.name) === "run_subagent"
    && Boolean(describeCrewRunSubagent(card?.arguments || {}));
}

export function settleCrewReviewDispatchCards(messages, reviewOf = "") {
  const target = String(reviewOf || "").trim().toLowerCase();
  if (!target) return messages;
  return (Array.isArray(messages) ? messages : []).map((message) =>
    settleRunningCreatePlanCards(message, {
      reason: "completed",
      match: (card) => {
        if (!isCrewDispatchCard(card)) return false;
        const review = String(card?.arguments?.review || "").trim().toLowerCase();
        if (review) return review === target;
        const described = describeCrewRunSubagent(card?.arguments || {});
        return String(described?.kind || "") === "review"
          && String(described?.label || "").toLowerCase().includes(target);
      },
    })
  );
}

export function settleLingeringCrewDispatchCards(messages = []) {
  return (Array.isArray(messages) ? messages : []).map((message) =>
    settleRunningCreatePlanCards(message, {
      reason: "completed",
      match: isCrewDispatchCard,
    })
  );
}

export function sanitizeCrewMessageFileChanges(message, { crewActive } = {}) {
  if (!message || !crewActive) return message;
  if (shouldShowCrewModeFileChanges(message, { crewActive })) return message;
  if (!Array.isArray(message.fileChanges) || message.fileChanges.length === 0) {
    return message;
  }
  return { ...message, fileChanges: [] };
}
