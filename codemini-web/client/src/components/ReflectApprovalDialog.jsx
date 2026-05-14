import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { t } from "../../i18n/index.js";

function confidenceLabel(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "0.75";
  return num.toFixed(2);
}

export function ReflectApprovalCard({ draft, onAction, disabled = false }) {
  const [editMode, setEditMode] = useState(false);
  const [feedback, setFeedback] = useState("");
  if (!draft) return null;

  const submitEdit = () => {
    const text = feedback.trim();
    if (!text) return;
    onAction("edit", text);
    setEditMode(false);
    setFeedback("");
  };

  return (
    <div className="border border-(--border-default) rounded-lg p-3 max-w-3xl mx-auto bg-(--bg-secondary) space-y-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[13px] font-medium text-(--text-primary)">
              {t("reflectReviewTitle")}
            </span>
            <Badge className="text-[11px] bg-(--accent-purple-bg) text-accent-purple">
              {t("reflectReviewStatus")}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-(--text-muted)">
            <span>{t("reflectScope")}: {draft.scope || "project"}</span>
            <span>{t("reflectConfidence")}: {confidenceLabel(draft.confidence)}</span>
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <div className="text-[14px] font-medium text-(--text-primary) break-words">
          /{draft.name || "reflected-skill"}
        </div>
        {draft.description && (
          <p className="text-[13px] leading-relaxed text-(--text-secondary)">
            {draft.description}
          </p>
        )}
        {draft.targetPath && (
          <p className="text-[12px] font-mono break-all text-(--text-muted)">
            {draft.targetPath}
          </p>
        )}
      </div>

      {draft.content && (
        <pre className="max-h-56 overflow-auto rounded-md border border-(--border-default) bg-(--bg-primary) p-3 text-[12px] leading-relaxed text-(--text-secondary) whitespace-pre-wrap">
          {draft.content}
        </pre>
      )}

      {editMode && (
        <Textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder={t("reflectEditPlaceholder")}
          className="min-h-[68px] text-[13px]"
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
          {t("reflectReject")}
        </Button>
        <Button
          variant="outline"
          size="xs"
          disabled={disabled || (editMode && !feedback.trim())}
          onClick={() => (editMode ? submitEdit() : setEditMode(true))}
        >
          {editMode ? t("reflectSubmitFeedback") : t("reflectEdit")}
        </Button>
        <Button size="xs" disabled={disabled} onClick={() => onAction("approve")}>
          {t("reflectApprove")}
        </Button>
      </div>
    </div>
  );
}
