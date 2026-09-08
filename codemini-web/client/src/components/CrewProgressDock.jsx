import { SessionOrb } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { t } from "../../i18n/index.js";
import {
  buildCrewProgressItems,
  shouldShowCrewProgressDock,
} from "../../../../src/core/crew-progress.js";

const PHASE_LABEL_KEY = {
  queued: "crewPhaseQueued",
  running: "crewPhaseRunning",
  reviewing: "crewPhaseReviewing",
  awaiting_review: "crewPhaseAwaitingReview",
  ready: "crewPhaseReady",
  dirty: "crewPhaseDirty",
  merged: "crewPhaseMerged",
  failed: "crewPhaseFailed",
  survey_done: "crewPhaseSurveyDone",
  idle: "crewPhaseIdle",
};

const KIND_LABEL_KEY = {
  survey: "crewKindSurvey",
  reviewer: "crewKindReviewer",
  coder: "crewKindCoder",
};

function phaseDotClass(phase) {
  if (phase === "failed" || phase === "dirty") return "bg-(--accent-red)";
  if (phase === "merged" || phase === "ready" || phase === "survey_done") {
    return "bg-(--accent-green)";
  }
  if (phase === "reviewing" || phase === "awaiting_review") {
    return "bg-(--accent-orange)";
  }
  if (phase === "running") return "bg-(--accent-blue)";
  return "bg-(--text-muted)";
}

function phaseLabel(phase) {
  return t(PHASE_LABEL_KEY[phase] || "crewPhaseIdle");
}

export function CrewProgressDock({ runtimeState }) {
  const crewActive = Boolean(runtimeState?.crewActive);
  const workers = Array.isArray(runtimeState?.crewWorkers)
    ? runtimeState.crewWorkers
    : [];
  const inFlightIds = Array.isArray(runtimeState?.crewInFlightIds)
    ? runtimeState.crewInFlightIds
    : [];
  if (!shouldShowCrewProgressDock({ crewActive, workers, inFlightIds })) {
    return null;
  }
  const items = buildCrewProgressItems({ workers, inFlightIds });

  return (
    <section
      className="codemini-message-surface mb-2 overflow-hidden rounded-xl px-3 py-2.5"
      aria-label={t("crewProgressTitle")}
    >
      <div className="mb-1.5 text-[12px] font-medium text-(--text-secondary)">
        {t("crewProgressTitle")}
      </div>
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const live = item.phase === "running" || item.phase === "reviewing";
          const kindKey = KIND_LABEL_KEY[item.kind] || KIND_LABEL_KEY.coder;
          return (
            <li
              key={item.id}
              className="flex min-h-6 items-center gap-2 text-[13px] leading-5"
            >
              {live ? (
                <SessionOrb state="working" />
              ) : (
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    phaseDotClass(item.phase),
                  )}
                />
              )}
              <span className="min-w-0 truncate font-medium text-(--text-primary)">
                {item.id}
              </span>
              <span className="shrink-0 text-[11px] uppercase tracking-[0.04em] text-(--text-muted)">
                {t(kindKey)}
              </span>
              <span className="ml-auto shrink-0 text-(--text-secondary)">
                {phaseLabel(item.phase)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
