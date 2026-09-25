import {
  buildCrewProgressItems,
  formatCrewProgressLine,
  shouldShowCrewProgressDock,
} from "../../../../src/core/crew-progress.js";

export const CREW_PHASE_LABEL_KEY = {
  queued: "crewPhaseQueued",
  running: "crewPhaseRunning",
  reviewing: "crewPhaseReviewing",
  awaiting_review: "crewPhaseAwaitingReview",
  ready: "crewPhaseReady",
  dirty: "crewPhaseDirty",
  merged: "crewPhaseMerged",
  merging: "crewPhaseMerging",
  failed: "crewPhaseFailed",
  survey_done: "crewPhaseSurveyDone",
  idle: "crewPhaseIdle",
};

export function crewPhaseLabels(t) {
  return Object.fromEntries(
    Object.entries(CREW_PHASE_LABEL_KEY).map(([phase, key]) => [
      phase,
      t(key),
    ]),
  );
}

export function getCrewStatusBarText(runtimeState, t) {
  const crewActive = Boolean(runtimeState?.crewActive);
  const workers = Array.isArray(runtimeState?.crewWorkers)
    ? runtimeState.crewWorkers
    : [];
  const inFlightIds = Array.isArray(runtimeState?.crewInFlightIds)
    ? runtimeState.crewInFlightIds
    : [];
  if (!shouldShowCrewProgressDock({ crewActive, workers, inFlightIds })) {
    return "";
  }
  const items = buildCrewProgressItems({ workers, inFlightIds }).filter(
    (item) => item.phase !== "merged",
  );
  if (!items.length) return "";
  return formatCrewProgressLine(items, crewPhaseLabels(t));
}
