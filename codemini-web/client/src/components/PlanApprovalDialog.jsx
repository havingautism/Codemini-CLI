import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { t } from "../../i18n/index.js";
import { ROLE_BADGE_CLASS, ROLE_PILLS } from "./PlanProgress.jsx";
import {
  ReviewFooter,
  ReviewMarkdown,
  ReviewSection,
  ReviewTaskPreview,
  ReviewCard,
  WorkflowReviewDialog,
} from "@/components/WorkflowReviewDialog.jsx";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";

const PLAN_STEP_ROLES = [
  "explorer",
  "architect",
  "advisor",
  "coder",
  "refactorer",
  "reviewer",
  "tester",
  "debugger",
  "writer",
  "summarizer",
  "planner",
];

function cloneSteps(steps = []) {
  return (Array.isArray(steps) ? steps : []).map((step) => ({
    role: String(step?.role || "explorer").trim() || "explorer",
    title: String(step?.title || "").trim(),
    task: String(step?.task || "").trim(),
  }));
}

function emptyStep() {
  return { role: "explorer", title: "", task: "" };
}

function PlanStepCard({ step, index }) {
  const role = String(step.role || "step");
  return (
    <ReviewCard className="space-y-2">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-(--border-default) bg-(--bg-primary) text-[11px] font-medium text-(--text-muted)">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                ROLE_BADGE_CLASS,
                "shrink-0",
                ROLE_PILLS[role] ||
                  "border-(--border-default) bg-(--bg-primary) text-(--text-muted)",
              )}
            >
              {role.toUpperCase()}
            </Badge>
            {step.title ? (
              <span className="text-sm font-medium text-foreground">
                {step.title}
              </span>
            ) : null}
          </div>
          {step.task ? (
            <ReviewSection label={t("planStepTask")}>
              <ReviewTaskPreview
                text={step.task}
                expandLabel={t("reviewShowMore")}
                collapseLabel={t("reviewShowLess")}
              />
            </ReviewSection>
          ) : null}
        </div>
      </div>
    </ReviewCard>
  );
}

function PlanStepEditor({
  step,
  index,
  total,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}) {
  return (
    <ReviewCard className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-(--text-muted)">
          {t("planStepLabel")} {index + 1}
        </span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={index === 0}
            onClick={onMoveUp}
            aria-label={t("planStepMoveUp")}
          >
            <ChevronUp size={14} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={index >= total - 1}
            onClick={onMoveDown}
            aria-label={t("planStepMoveDown")}
          >
            <ChevronDown size={14} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={total <= 1}
            onClick={onRemove}
            aria-label={t("planStepRemove")}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
        <ReviewSection label={t("planStepRole")}>
          <Select
            value={step.role || "explorer"}
            onValueChange={(value) => onChange({ ...step, role: value })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLAN_STEP_ROLES.map((role) => (
                <SelectItem key={role} value={role}>
                  {role.toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ReviewSection>
        <ReviewSection label={t("planStepTitle")}>
          <Input
            value={step.title || ""}
            onChange={(e) => onChange({ ...step, title: e.target.value })}
            className="h-9 text-sm"
            placeholder={t("planStepTitlePlaceholder")}
          />
        </ReviewSection>
      </div>

      <ReviewSection label={t("planStepTask")}>
        <Textarea
          value={step.task || ""}
          onChange={(e) => onChange({ ...step, task: e.target.value })}
          className="min-h-24 text-sm"
          placeholder={t("planStepTaskPlaceholder")}
        />
      </ReviewSection>
    </ReviewCard>
  );
}

export function PlanApprovalDialog({
  plan,
  open = false,
  onAction,
  onUpdate,
  disabled = false,
}) {
  const [panel, setPanel] = useState("review");
  const [draft, setDraft] = useState({ goal: "", summary: "", steps: [] });
  const [reviseFeedback, setReviseFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  const planSignature = plan
    ? `${plan.goal || ""}|${plan.summary || ""}|${(plan.steps || [])
        .map((step) => `${step.role}:${step.title}:${step.task}`)
        .join("\n")}`
    : "";

  useEffect(() => {
    if (!open) {
      setPanel("review");
      setReviseFeedback("");
      setSaving(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setPanel("review");
    setReviseFeedback("");
  }, [open, planSignature]);

  if (!plan) return null;
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const summary = plan.finalSummary || plan.summary || "";

  const startEdit = () => {
    setDraft({
      goal: plan.goal || "",
      summary,
      steps: cloneSteps(steps),
    });
    setPanel("edit");
  };

  const startRevise = () => {
    setReviseFeedback("");
    setPanel("revise");
  };

  const cancelPanel = () => {
    setPanel("review");
    setReviseFeedback("");
  };

  const updateStep = (index, nextStep) => {
    setDraft((prev) => ({
      ...prev,
      steps: prev.steps.map((step, i) => (i === index ? nextStep : step)),
    }));
  };

  const moveStep = (index, direction) => {
    setDraft((prev) => {
      const nextSteps = [...prev.steps];
      const target = index + direction;
      if (target < 0 || target >= nextSteps.length) return prev;
      [nextSteps[index], nextSteps[target]] = [nextSteps[target], nextSteps[index]];
      return { ...prev, steps: nextSteps };
    });
  };

  const removeStep = (index) => {
    setDraft((prev) => ({
      ...prev,
      steps: prev.steps.filter((_, i) => i !== index),
    }));
  };

  const addStep = () => {
    setDraft((prev) => ({
      ...prev,
      steps: [...prev.steps, emptyStep()],
    }));
  };

  const saveEdit = async () => {
    const nextSteps = draft.steps
      .map((step) => ({
        role: String(step.role || "").trim(),
        title: String(step.title || "").trim(),
        task: String(step.task || "").trim(),
      }))
      .filter((step) => step.title || step.task);
    const next = {
      ...plan,
      goal: draft.goal.trim(),
      summary: draft.summary.trim(),
      finalSummary: draft.summary.trim(),
      steps: nextSteps,
    };
    setSaving(true);
    try {
      if (onUpdate) await onUpdate(next);
      setPanel("review");
    } finally {
      setSaving(false);
    }
  };

  const submitRevise = () => {
    const feedback = reviseFeedback.trim();
    if (!feedback || !onAction) return;
    onAction("revise", feedback);
  };

  const handleOpenChange = (nextOpen) => {
    if (nextOpen) return;
    if (panel !== "review") cancelPanel();
  };

  let footer = null;
  if (panel === "edit") {
    footer = (
      <ReviewFooter
        leading={
          <Button variant="outline" size="sm" disabled={disabled || saving} onClick={cancelPanel}>
            {t("cancel")}
          </Button>
        }
        trailing={
          <Button size="sm" disabled={disabled || saving} onClick={saveEdit}>
            {saving ? t("planSaving") : t("planSave")}
          </Button>
        }
      />
    );
  } else if (panel === "revise") {
    footer = (
      <ReviewFooter
        leading={
          <Button variant="outline" size="sm" disabled={disabled} onClick={cancelPanel}>
            {t("cancel")}
          </Button>
        }
        trailing={
          <Button size="sm" disabled={disabled || !reviseFeedback.trim()} onClick={submitRevise}>
            {t("planSubmitFeedback")}
          </Button>
        }
      />
    );
  } else {
    footer = (
      <ReviewFooter
        leading={
          <Button variant="destructive" size="sm" disabled={disabled} onClick={() => onAction("reject")}>
            {t("planReject")}
          </Button>
        }
        trailing={
          <>
            <Button variant="outline" size="sm" disabled={disabled} onClick={startEdit}>
              {t("planEdit")}
            </Button>
            <Button variant="outline" size="sm" disabled={disabled} onClick={startRevise}>
              {t("planReviseWithAi")}
            </Button>
            <Button size="sm" disabled={disabled} onClick={() => onAction("approve")}>
              {t("planApprove")}
            </Button>
          </>
        }
      />
    );
  }

  return (
    <WorkflowReviewDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t("planReviewTitle")}
      description={plan.filePath || undefined}
      badge={t("planReviewStatus")}
      badgeVariant="outline"
      badgeClassName="border-(--border-default) bg-[color-mix(in_srgb,var(--bg-primary)_72%,var(--bg-secondary)_28%)] text-(--text-primary)"
      footer={footer}
    >
      {panel === "edit" ? (
        <div className="space-y-4">
          <ReviewSection label={t("planReviewGoal")}>
            <Textarea
              value={draft.goal}
              onChange={(e) => setDraft((prev) => ({ ...prev, goal: e.target.value }))}
              className="min-h-[88px] text-sm"
            />
          </ReviewSection>
          <ReviewSection label={t("planReviewSummary")}>
            <Textarea
              value={draft.summary}
              onChange={(e) => setDraft((prev) => ({ ...prev, summary: e.target.value }))}
              className="min-h-[72px] text-sm"
            />
          </ReviewSection>
          <ReviewSection
            label={t("planReviewSteps")}
            action={
              <Button type="button" variant="outline" size="xs" onClick={addStep}>
                <Plus size={12} />
                {t("planStepAdd")}
              </Button>
            }
          >
            <div className="space-y-2">
              {draft.steps.map((step, i) => (
                <PlanStepEditor
                  key={`edit-step-${i}`}
                  step={step}
                  index={i}
                  total={draft.steps.length}
                  onChange={(nextStep) => updateStep(i, nextStep)}
                  onMoveUp={() => moveStep(i, -1)}
                  onMoveDown={() => moveStep(i, 1)}
                  onRemove={() => removeStep(i)}
                />
              ))}
            </div>
          </ReviewSection>
        </div>
      ) : panel === "revise" ? (
        <div className="space-y-3">
          <ReviewText className="text-(--text-secondary)">{t("planReviseHint")}</ReviewText>
          <Textarea
            value={reviseFeedback}
            onChange={(e) => setReviseFeedback(e.target.value)}
            className="min-h-[180px] text-sm"
            placeholder={t("planEditPlaceholder")}
            autoFocus
          />
        </div>
      ) : (
        <>
          {plan.goal ? (
            <ReviewSection label={t("planReviewGoal")}>
              <ReviewMarkdown>{plan.goal}</ReviewMarkdown>
            </ReviewSection>
          ) : null}

          {summary ? (
            <ReviewSection label={t("planReviewSummary")}>
              <ReviewMarkdown>{summary}</ReviewMarkdown>
            </ReviewSection>
          ) : null}

          {steps.length > 0 ? (
            <ReviewSection
              label={t("planReviewSteps")}
              action={
                <span className="text-xs text-(--text-muted)">
                  {steps.length} {t("planStepCount")}
                </span>
              }
            >
              <div className="space-y-2">
                {steps.map((step, i) => (
                  <PlanStepCard key={`${step.role}-${step.title}-${i}`} step={step} index={i} />
                ))}
              </div>
            </ReviewSection>
          ) : null}
        </>
      )}
    </WorkflowReviewDialog>
  );
}

/** @deprecated Use PlanApprovalDialog */
export const PlanApprovalCard = PlanApprovalDialog;
