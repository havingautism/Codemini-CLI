import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { t } from "../../i18n/index.js";
import { ROLE_PILLS } from "./PlanProgress.jsx";

function stepsToText(steps = []) {
  return (Array.isArray(steps) ? steps : [])
    .map((step) => `${step.role || ""} | ${step.title || ""} | ${step.task || ""}`)
    .join("\n");
}

function textToSteps(value = "") {
  return String(value || "")
    .split("\n")
    .map((line) => {
      const [role = "", title = "", ...taskParts] = line.split("|").map((part) => part.trim());
      return { role, title, task: taskParts.join(" | ").trim() };
    })
    .filter((step) => step.role || step.title || step.task);
}

export function PlanApprovalCard({ plan, onAction, onUpdate, disabled = false }) {
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState({ goal: "", summary: "", stepsText: "" });
  if (!plan) return null;
  const steps = Array.isArray(plan.steps) ? plan.steps : [];

  const startEdit = () => {
    setDraft({
      goal: plan.goal || "",
      summary: plan.summary || "",
      stepsText: stepsToText(steps),
    });
    setEditMode(true);
  };

  const saveEdit = async () => {
    const next = {
      ...plan,
      goal: draft.goal,
      summary: draft.summary,
      finalSummary: draft.summary,
      steps: textToSteps(draft.stepsText),
    };
    if (onUpdate) await onUpdate(next);
    setEditMode(false);
  };

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

      {editMode ? (
        <div className="space-y-2">
          <Input
            value={draft.goal}
            onChange={(e) => setDraft((prev) => ({ ...prev, goal: e.target.value }))}
            className="h-8 text-[13px]"
          />
          <Textarea
            value={draft.summary}
            onChange={(e) => setDraft((prev) => ({ ...prev, summary: e.target.value }))}
            className="min-h-[56px] text-[13px]"
          />
          <Textarea
            value={draft.stepsText}
            onChange={(e) => setDraft((prev) => ({ ...prev, stepsText: e.target.value }))}
            className="min-h-[112px] font-mono text-[12px]"
          />
        </div>
      ) : (
        <p className="text-[13px] text-(--text-secondary) leading-relaxed">
          {plan.goal}
        </p>
      )}

      {!editMode && plan.summary && (
        <p className="text-[12px] text-(--text-muted) leading-relaxed">
          {plan.summary}
        </p>
      )}

      {!editMode && <div className="space-y-1.5">
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
      </div>}

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
          disabled={disabled}
          onClick={() => (editMode ? saveEdit() : startEdit())}
        >
          {editMode ? t("specSave") : t("planEdit")}
        </Button>
        <Button size="xs" disabled={disabled} onClick={() => onAction("approve")}>
          {t("planApprove")}
        </Button>
      </div>
    </div>
  );
}
