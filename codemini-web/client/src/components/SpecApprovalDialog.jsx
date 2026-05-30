import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ReviewFooter,
  ReviewMarkdown,
  ReviewNotice,
  ReviewSection,
  WorkflowReviewDialog,
} from "@/components/WorkflowReviewDialog.jsx";
import { t } from "../../i18n/index.js";

export function SpecApprovalDialog({
  spec,
  open = false,
  onAction,
  onUpdate,
  disabled = false,
}) {
  const [editMode, setEditMode] = useState(false);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const specSignature = spec
    ? `${spec.goal || ""}|${spec.filePath || ""}|${spec.specText || ""}|${(spec.missingHeadings || []).join(",")}`
    : "";

  useEffect(() => {
    if (!open) {
      setEditMode(false);
      setContent("");
      setSaving(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setEditMode(false);
    setContent("");
  }, [open, specSignature]);

  if (!spec) return null;

  const missingHeadings = Array.isArray(spec.missingHeadings)
    ? spec.missingHeadings
    : [];
  const incomplete = spec.complete === false || missingHeadings.length > 0;

  const startEdit = () => {
    setContent(spec.specText || "");
    setEditMode(true);
  };

  const cancelEdit = () => {
    setEditMode(false);
    setContent("");
  };

  const saveEdit = async () => {
    const next = { ...spec, specText: content };
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
        <Button variant="outline" size="sm" disabled={disabled || saving} onClick={cancelEdit}>
          {t("cancel")}
        </Button>
      }
      trailing={
        <Button size="sm" disabled={disabled || saving} onClick={saveEdit}>
          {saving ? t("planSaving") : t("specSave")}
        </Button>
      }
    />
  ) : (
    <ReviewFooter
      leading={
        <>
          <Button variant="destructive" size="sm" disabled={disabled} onClick={() => onAction("delete")}>
            {t("specDelete")}
          </Button>
          <Button variant="outline" size="sm" disabled={disabled} onClick={() => onAction("reject")}>
            {t("specReject")}
          </Button>
        </>
      }
      trailing={
        <>
          <Button variant="outline" size="sm" disabled={disabled} onClick={startEdit}>
            {t("specEdit")}
          </Button>
          <Button variant="outline" size="sm" disabled={disabled} onClick={() => onAction("save")}>
            {t("specSaveOnly")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled || incomplete}
            onClick={() => onAction("approve")}
          >
            {t("specPlanExecute")}
          </Button>
          <Button size="sm" disabled={disabled || incomplete} onClick={() => onAction("execute")}>
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
      {spec.goal ? (
        <ReviewSection label={t("planReviewGoal")}>
          <ReviewMarkdown>{spec.goal}</ReviewMarkdown>
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
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="min-h-[320px] font-mono text-xs"
            autoFocus
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
