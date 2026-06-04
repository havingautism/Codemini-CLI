import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { t } from "../../i18n/index.js";
import { X } from "@phosphor-icons/react";
import { PlanStepStatusGlyph } from "@/components/plan-step-icons.jsx";

export const ROLE_PILLS = {
  planner: "border-(--border-default) bg-(--bg-secondary) text-(--text-secondary)",
  explorer: "border-(--border-default) bg-(--bg-secondary) text-(--text-secondary)",
  architect: "border-(--border-default) bg-(--bg-secondary) text-(--text-secondary)",
  coder: "border-(--border-default) bg-(--bg-secondary) text-(--text-secondary)",
  refactorer: "border-(--border-default) bg-(--bg-secondary) text-(--text-secondary)",
  reviewer: "border-(--border-default) bg-(--bg-secondary) text-(--text-secondary)",
  tester: "border-(--border-default) bg-(--bg-secondary) text-(--text-secondary)",
  advisor: "border-(--border-default) bg-(--bg-secondary) text-(--text-secondary)",
  debugger: "border-(--border-default) bg-(--bg-secondary) text-(--text-secondary)",
  writer: "border-(--border-default) bg-(--bg-secondary) text-(--text-secondary)",
  summarizer: "border-(--border-default) bg-(--bg-secondary) text-(--text-secondary)",
};

export const ROLE_BADGE_CLASS =
  "h-5 rounded-md px-1.5 py-0 text-[10px] font-medium uppercase tracking-[0.04em] shadow-none";

const STEP_STATUS_STYLES = {
  done:
    "border-[color-mix(in_srgb,var(--accent-green)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent-green-bg)_52%,transparent)] text-(--accent-green)",
  failed:
    "border-[color-mix(in_srgb,var(--accent-red)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent-red-bg)_52%,transparent)] text-(--accent-red)",
  running:
    "border-[color-mix(in_srgb,var(--accent-blue)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent-blue-bg)_52%,transparent)] text-(--accent-blue)",
  pending: "border-(--border-default) bg-(--bg-primary) text-(--text-muted)",
};

export function PlanProgress({ steps, onDismiss }) {
  if (!steps?.length) return null;

  const done = steps.filter((s) => s.status === "done").length;
  const allDone = done === steps.length;
  const pct = Math.round((done / steps.length) * 100);

  return (
    <div className="relative my-2 max-w-3xl mx-auto rounded-lg border border-(--border-default) bg-(--bg-primary) p-3 shadow-[var(--shadow-sm)]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[13px] font-medium text-(--text-primary)">
          {t("planTitle")}
        </span>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={cn(
              "h-5 rounded-md px-1.5 py-0 text-[11px] font-medium shadow-none",
              allDone
                ? "border-[color-mix(in_srgb,var(--accent-green)_28%,transparent)] bg-[color-mix(in_srgb,var(--accent-green-bg)_55%,transparent)] text-(--accent-green)"
                : "border-[color-mix(in_srgb,var(--accent-blue)_28%,transparent)] bg-[color-mix(in_srgb,var(--accent-blue-bg)_55%,transparent)] text-(--accent-blue)",
            )}
          >
            {allDone ? t("planDone") : `${done}/${steps.length}`}
          </Badge>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-(--border-default) bg-(--bg-secondary) text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary)"
              title={t("closePlanProgress")}
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>
      <Progress value={pct} className="h-1.5 mb-3" />
      <div className="space-y-1.5">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-2 text-[13px]">
            <span
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium",
                STEP_STATUS_STYLES[step.status] || STEP_STATUS_STYLES.pending,
              )}
            >
              <PlanStepStatusGlyph step={step} index={i} />
            </span>
            <Badge
              variant="outline"
              className={cn(
                ROLE_BADGE_CLASS,
                ROLE_PILLS[step.role] ||
                  "border-(--border-default) bg-(--bg-primary) text-(--text-muted)",
              )}
            >
              {step.role?.toUpperCase()}
            </Badge>
            <span className="truncate text-(--text-secondary)">
              {step.title}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
