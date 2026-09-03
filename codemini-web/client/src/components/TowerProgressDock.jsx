import { SessionOrb } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { t } from "../../i18n/index.js";
import {
  buildTowerProgressItems,
  shouldShowTowerProgressDock,
} from "../../../../src/core/tower-progress.js";

const PHASE_LABEL_KEY = {
  running: "towerPhaseRunning",
  reviewing: "towerPhaseReviewing",
  awaiting_review: "towerPhaseAwaitingReview",
  ready: "towerPhaseReady",
  dirty: "towerPhaseDirty",
  merged: "towerPhaseMerged",
  failed: "towerPhaseFailed",
  survey_done: "towerPhaseSurveyDone",
  idle: "towerPhaseIdle",
};

const KIND_LABEL_KEY = {
  survey: "towerKindSurvey",
  reviewer: "towerKindReviewer",
  coder: "towerKindCoder",
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
  return t(PHASE_LABEL_KEY[phase] || "towerPhaseIdle");
}

export function TowerProgressDock({ runtimeState }) {
  const towerActive = Boolean(runtimeState?.towerActive);
  const workers = Array.isArray(runtimeState?.towerWorkers)
    ? runtimeState.towerWorkers
    : [];
  const inFlightIds = Array.isArray(runtimeState?.towerInFlightIds)
    ? runtimeState.towerInFlightIds
    : [];
  if (!shouldShowTowerProgressDock({ towerActive, workers, inFlightIds })) {
    return null;
  }
  const items = buildTowerProgressItems({ workers, inFlightIds });

  return (
    <section
      className="codemini-message-surface mb-2 overflow-hidden rounded-xl px-3 py-2.5"
      aria-label={t("towerProgressTitle")}
    >
      <div className="mb-1.5 text-[12px] font-medium text-(--text-secondary)">
        {t("towerProgressTitle")}
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
