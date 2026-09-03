import { describeTowerRunSubagent } from "../../../../src/core/tool-display.js";
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

export function messageHasTowerDispatchCards(message) {
  for (const card of iterateToolCards(message?.segments)) {
    if (normalizeToolName(card?.name) !== "run_subagent") continue;
    if (describeTowerRunSubagent(card?.arguments || {})) return true;
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

/** Tower parent should not mirror worker worktree edits on dispatch/status bubbles. */
export function shouldShowTowerModeFileChanges(message, { towerActive } = {}) {
  if (!towerActive) return true;
  if (messageHasLandWorkersTool(message)) return true;
  if (messageHasTowerDispatchCards(message)) return false;
  return false;
}

/** Agent todo panels are misleading in tower mode — workers run asynchronously. */
export function shouldSuppressTowerTaskTodos({ towerActive } = {}) {
  return Boolean(towerActive);
}

/** Nested worker tools (not the parent spawn/review card) belong on the owner card. */
export function isTowerBackgroundWorkerToolEvent(event, { towerActive } = {}) {
  if (!towerActive || !event) return false;
  return Boolean(String(event.parentToolCallId || "").trim());
}

function isTowerDispatchCard(card) {
  return normalizeToolName(card?.name) === "run_subagent"
    && Boolean(describeTowerRunSubagent(card?.arguments || {}));
}

export function settleTowerReviewDispatchCards(messages, reviewOf = "") {
  const target = String(reviewOf || "").trim().toLowerCase();
  if (!target) return messages;
  return (Array.isArray(messages) ? messages : []).map((message) =>
    settleRunningCreatePlanCards(message, {
      reason: "completed",
      match: (card) => {
        if (!isTowerDispatchCard(card)) return false;
        const review = String(card?.arguments?.review || "").trim().toLowerCase();
        if (review) return review === target;
        const described = describeTowerRunSubagent(card?.arguments || {});
        return String(described?.kind || "") === "review"
          && String(described?.label || "").toLowerCase().includes(target);
      },
    })
  );
}

export function settleLingeringTowerDispatchCards(messages = []) {
  return (Array.isArray(messages) ? messages : []).map((message) =>
    settleRunningCreatePlanCards(message, {
      reason: "completed",
      match: isTowerDispatchCard,
    })
  );
}

export function sanitizeTowerMessageFileChanges(message, { towerActive } = {}) {
  if (!message || !towerActive) return message;
  if (shouldShowTowerModeFileChanges(message, { towerActive })) return message;
  if (!Array.isArray(message.fileChanges) || message.fileChanges.length === 0) {
    return message;
  }
  return { ...message, fileChanges: [] };
}
