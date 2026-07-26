import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownEditor } from "@/components/MarkdownEditor.jsx";
import {
  ReviewFooter,
  ReviewMarkdown,
  ReviewNotice,
  ReviewSection,
  WorkflowReviewDialog,
} from "@/components/WorkflowReviewDialog.jsx";
import { t } from "../../i18n/index.js";
import { CHAT_ACTION_NAMES, LOCAL_SPEC_REVIEW_ACTIONS } from "@/lib/chat-action-names.js";

export function SpecApprovalDialog({
  spec,
  open = false,
  onAction,
  onUpdate,
  disabled = false,
}) {
  const [editMode, setEditMode] = useState(false);
  const [goal, setGoal] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const specSignature = spec
    ? `${spec.goal || ""}|${spec.filePath || ""}|${spec.specText || ""}|${(spec.missingHeadings || []).join(",")}`
    : "";

  useEffect(() => {
    if (!open) {
      setEditMode(false);
      setGoal("");
      setContent("");
      setSaving(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setEditMode(false);
    setGoal("");
    setContent("");
  }, [open, specSignature]);

  if (!spec) return null;

  const missingHeadings = Array.isArray(spec.missingHeadings)
    ? spec.missingHeadings
    : [];
  const incomplete = spec.complete === false || missingHeadings.length > 0;

  const startEdit = () => {
    setGoal(spec.goal || "");
    setContent(spec.specText || "");
    setEditMode(true);
  };

  const cancelEdit = () => {
    setEditMode(false);
    setGoal("");
    setContent("");
  };

  const saveEdit = async () => {
    const next = {
      ...spec,
      goal: String(goal || "").trim(),
      specText: content,
    };
    setSaving(true);
    try {
      if (onUpdate) await onUpdate(next);
      setEditMode(false);
    } finally {
      setSaving(false);
    }
  };

  const handleOpenChange = (nextOpen) => {
    if (nextOpen) return;
    if (editMode) cancelEdit();
  };

  const footer = editMode ? (
    <ReviewFooter
      leading={
        <Button
          variant="outline"
          disabled={disabled || saving}
          onClick={cancelEdit}
        >
          {t("cancel")}
        </Button>
      }
      trailing={
        <Button disabled={disabled || saving} onClick={saveEdit}>
          {saving ? t("planSaving") : t("specSave")}
        </Button>
      }
    />
  ) : (
    <ReviewFooter
      leading={
        <>
          <Button
            variant="destructive"
            disabled={disabled}
            onClick={() => onAction(LOCAL_SPEC_REVIEW_ACTIONS.DELETE)}
          >
            {t("specDelete")}
          </Button>
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => onAction(CHAT_ACTION_NAMES.SPEC_REJECT)}
          >
            {t("specReject")}
          </Button>
        </>
      }
      trailing={
        <>
          <Button
            variant="outline"
            disabled={disabled}
            onClick={startEdit}
          >
            {t("specEdit")}
          </Button>
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => onAction(CHAT_ACTION_NAMES.SPEC_SAVE)}
          >
            {t("specSaveOnly")}
          </Button>
          <Button
            variant="outline"
            disabled={disabled || incomplete}
            onClick={() => onAction(CHAT_ACTION_NAMES.SPEC_PLAN_AND_EXECUTE)}
          >
            {t("specPlanExecute")}
          </Button>
          <Button
            disabled={disabled || incomplete}
            onClick={() => onAction(CHAT_ACTION_NAMES.SPEC_EXECUTE)}
          >
            {t("specExecuteNow")}
          </Button>
        </>
      }
    />
  );

  return (
    <WorkflowReviewDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t("specReviewTitle")}
      description={spec.filePath || undefined}
      badge={incomplete ? t("specIncompleteStatus") : t("specReviewStatus")}
      badgeVariant={incomplete ? "destructive" : "secondary"}
      footer={footer}
    >
      {(editMode || spec.goal) ? (
        <ReviewSection label={t("planReviewGoal")}>
          {editMode ? (
            <Textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              className="min-h-18 text-sm"
              placeholder={t("planReviewGoal")}
              autoFocus
            />
          ) : (
            <ReviewMarkdown>{spec.goal}</ReviewMarkdown>
          )}
        </ReviewSection>
      ) : null}

      {incomplete && (
        <ReviewNotice variant="destructive">
          {t("specIncompleteMessage")}
          {missingHeadings.length > 0 && (
            <div className="mt-1.5 font-mono text-xs opacity-90">
              {missingHeadings.join(", ")}
            </div>
          )}
        </ReviewNotice>
      )}

      <ReviewSection label={t("specDocumentBody")}>
        {editMode ? (
          <MarkdownEditor
            value={content}
            onChange={setContent}
            height={420}
            preview="live"
            placeholder={t("specDocumentBody")}
          />
        ) : (
          <ReviewMarkdown>{spec.specText || ""}</ReviewMarkdown>
        )}
      </ReviewSection>
    </WorkflowReviewDialog>
  );
}

/** @deprecated Use SpecApprovalDialog */
export const SpecApprovalCard = SpecApprovalDialog;
