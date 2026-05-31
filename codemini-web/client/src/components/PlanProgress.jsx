import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { t } from "../../i18n/index.js";
import { X } from "lucide-react";

export const ROLE_PILLS = {
  planner:
    "border-[color-mix(in_srgb,var(--accent-purple)_28%,transparent)] bg-[color-mix(in_srgb,var(--accent-purple-bg)_55%,transparent)] text-(--accent-purple)",
  explorer:
    "border-[color-mix(in_srgb,var(--accent-amber)_28%,transparent)] bg-[color-mix(in_srgb,var(--accent-amber-bg)_55%,transparent)] text-(--accent-amber)",
  architect:
    "border-[color-mix(in_srgb,var(--accent-purple)_28%,transparent)] bg-[color-mix(in_srgb,var(--accent-purple-bg)_55%,transparent)] text-(--accent-purple)",
  coder:
    "border-[color-mix(in_srgb,var(--accent-green)_28%,transparent)] bg-[color-mix(in_srgb,var(--accent-green-bg)_55%,transparent)] text-(--accent-green)",
  refactorer:
    "border-[color-mix(in_srgb,var(--accent-teal)_28%,transparent)] bg-[color-mix(in_srgb,var(--accent-teal-bg)_55%,transparent)] text-(--accent-teal)",
  reviewer:
    "border-[color-mix(in_srgb,var(--accent-orange)_28%,transparent)] bg-[color-mix(in_srgb,var(--accent-orange-bg)_55%,transparent)] text-(--accent-orange)",
  tester:
    "border-[color-mix(in_srgb,var(--accent-blue)_28%,transparent)] bg-[color-mix(in_srgb,var(--accent-blue-bg)_55%,transparent)] text-(--accent-blue)",
  advisor:
    "border-[color-mix(in_srgb,var(--accent-blue)_28%,transparent)] bg-[color-mix(in_srgb,var(--accent-blue-bg)_55%,transparent)] text-(--accent-blue)",
  debugger:
    "border-[color-mix(in_srgb,var(--accent-red)_28%,transparent)] bg-[color-mix(in_srgb,var(--accent-red-bg)_55%,transparent)] text-(--accent-red)",
  writer:
    "border-[color-mix(in_srgb,var(--accent-cyan)_28%,transparent)] bg-[color-mix(in_srgb,var(--accent-cyan-bg)_55%,transparent)] text-(--accent-cyan)",
  summarizer:
    "border-[color-mix(in_srgb,var(--accent-cyan)_28%,transparent)] bg-[color-mix(in_srgb,var(--accent-cyan-bg)_55%,transparent)] text-(--accent-cyan)",
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
              {step.status === "done"
                ? "✓"
                : step.status === "failed"
                  ? "✗"
                  : step.status === "running"
                    ? "▶"
                    : i + 1}
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
