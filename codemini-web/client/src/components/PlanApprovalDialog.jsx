import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { t } from "../../i18n/index.js";
import { ROLE_PILLS } from "./PlanProgress.jsx";

export function PlanApprovalCard({ plan, onAction, disabled = false }) {
  const [editMode, setEditMode] = useState(false);
  const [feedback, setFeedback] = useState("");
  if (!plan) return null;
  const steps = Array.isArray(plan.steps) ? plan.steps : [];

  return (
    <div className="border border-(--border-default) rounded-lg p-3 max-w-3xl mx-auto bg-(--bg-secondary) space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-(--text-primary)">
          {t("planReviewTitle")}
        </span>
        <Badge className="text-[11px] bg-(--accent-orange-bg) text-(--accent-orange)">
          {t("planReviewStatus")}
        </Badge>
      </div>

      <p className="text-[13px] text-(--text-secondary) leading-relaxed">
        {plan.goal}
      </p>

      {plan.summary && (
        <p className="text-[12px] text-(--text-muted) leading-relaxed">
          {plan.summary}
        </p>
      )}

      <div className="space-y-1.5">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-2 text-[13px]">
            <span className="w-5 h-5 rounded-full bg-(--muted) text-(--muted-foreground) flex items-center justify-center text-[11px] font-medium shrink-0">
              {i + 1}
            </span>
            <Badge
              variant="outline"
              className={cn(
                "text-[11px] px-1.5 py-0 shrink-0",
                ROLE_PILLS[step.role || ""] ||
                  "bg-(--muted) text-(--muted-foreground)",
              )}
            >
              {String(step.role || "step").toUpperCase()}
            </Badge>
            <span className="truncate text-(--text-secondary)">
              {step.title}
            </span>
          </div>
        ))}
      </div>

      {editMode && (
        <Textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder={t("planEditPlaceholder")}
          className="min-h-[64px] text-[13px]"
          autoFocus
        />
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button
          variant="destructive"
          size="xs"
          disabled={disabled}
          onClick={() => onAction("reject")}
        >
          {t("planReject")}
        </Button>
        <Button
          variant="outline"
          size="xs"
          disabled={disabled || (editMode && !feedback.trim())}
          onClick={() => {
            if (editMode) {
              if (feedback.trim()) onAction("edit", feedback);
              if (feedback.trim()) {
                setEditMode(false);
                setFeedback("");
              }
            } else {
              setEditMode(true);
            }
          }}
        >
          {editMode ? t("planSubmitFeedback") : t("planEdit")}
        </Button>
        <Button size="xs" disabled={disabled} onClick={() => onAction("approve")}>
          {t("planApprove")}
        </Button>
      </div>
    </div>
  );
}
